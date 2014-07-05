'use strict';

exports = module.exports = Generate;

var path = require('path');
var fs = require('fs');

var inflection = require('inflection');

var Models = require('./../models/models');

var Model = require('./../models/model');
var Migration = require('./migration');
var Migrations = require('./migrations');
var Q = require('q');

var mu = require('mu2');

var fire = require('./../../firestarter');

var basePath = path.resolve('./');

var PropertyTypes = require('./../models/property-types');

var debug = require('debug')('fire:migrate');

function addPropertiesMigrationTask(model, properties) {
	var string = '\tthis.models.' + model.getName() + '.addProperties({\n';

	string += properties.map(function(property) {
		return '\t\t' + property.name + ': ' + propertyTypesToString(property);
	}).join(',\n') + '\n';

	string += '\t});\n';
	return string;
}

function changePropertiesMigrationTask(model, properties) {
	var string = '\tthis.models.' + model.getName() + '.changeProperties({\n';

	string += properties.map(function(property) {
		return '\t\t' + property.name + ': ' + propertyTypesToString(property);
	}).join(',\n') + '\n';

	string += '\t});\n';
	return string;
}

function removePropertiesMigrationTask(model, properties) {
	var string = '\tthis.models.' + model.getName() + '.removeProperties([';

	string += properties.map(function(property) {
		return '\'' + property.name + '\'';
	}).join(', ');

	string += ']);\n';
	return string;
}

function createModelMigrationTask(model) {
	debug('createModelMigrationTask');

	var string = '\tthis.models.createModel(\'' + model.getName() + '\', {\n';

	var propertiesMap = model.getAllProperties();

	var properties = Object.keys(propertiesMap).map(function(propertyName) {
		var property = propertiesMap[propertyName];

		return '\t\t' + propertyName + ': ' + propertyTypesToString(property);
	});

	string += properties.join(',\n') + '\n';
	string += '\t});\n';
	return string;
}

function destroyModelMigrationTask(model) {
	return '\tthis.models.destroyModel(\'' + model.getName() + '\');\n';
}

function propertyTypesToString(property) {
	return '[' + property.types.map(function(type) {
		while(typeof type == 'function') {
			type = type.call(property, property);
		}

		if(!type) {
			throw new Error('No type in propertyTypesToString.');
		}

		var propertyTypeString = 'this.' + type.name;

		if(type.params && type.params.length > 0 && type.params[0] != property) {
			propertyTypeString += '(' + type.params.map(function(value, index) {
				// TOOD: Check if `value` is a model thingy?
				// TODO: Check if `value` exists on model?
				// For now, let's check if this is: Reference, Many, HasOne, HasMany

				var name = value;

				if(value instanceof Model) {
					name = value.getName();
				}

				if(['HasOne', 'HasMany', 'BelongsTo'].indexOf(type.name) >= 0) {
					if(index === 0) {
						return 'this.models.' + name;
					}
					else {
						return '"' + name + '"';
					}
				}
				else {
					return name;
				}
			}).join(', ') + ')';
		}

		return propertyTypeString;
	}).join(', ') + ']';
}

function Generate(startPath) {
	this.path = startPath;

	this.app = fire.app('', {
		disabled: true
	});
}

Generate.prototype.createMigrations = function() {
	// These are based on the actualy models
	var newModels = this.app.models;

	// ... and these are based on migrations
	var oldModels = new Models();

	var migrations 	= new Migrations();

	// Let's swizzle some methods
	Object.keys(PropertyTypes).forEach(function(propertyName) {
		Model.prototype[propertyName] = function() {
			return {
				name: propertyName,
				params: Array.prototype.splice.call(arguments, 0)
			};
		};
	});

	Object.keys(PropertyTypes).forEach(function(propertyName) {
        // We check if it's set already, as e.g. migrations swizzle these methods
        Migration.prototype[propertyName] = function() {
			return {
				name: propertyName,
				params: Array.prototype.splice.call(arguments, 0)
			};
		};
    });

	var toVersion = 0;

	// Let's load all models
	return newModels.setup(basePath, this.path)
		.then(function() {
			debug('Old models setup.');

			return oldModels.setup(null);
		})
		.then(function() {
			debug('Loading migrations to `oldModels` from `' + path.join(basePath, '_migrations') + '`.');

			// and load all migrations
			return migrations.loadMigrations(path.join(basePath, '_migrations'), oldModels);
		})
		.then(function() {
			debug('Reseting migration-models');

			// Now we copy all models and remove them from the models
			// We do a soft-migration to the last migration
			// Then compare all models created by the soft migration with the models we copied earlier
			// We create migrations based on the differences
			// Let's go!

			return migrations.resetAllModels();
		})
		.then(function() {
			debug('Soft migrating to ' + toVersion);

			if(migrations._.length > 0) {
				var lastMigration = migrations._[migrations._.length - 1];
				toVersion = lastMigration.version;
			}

			return migrations.softMigrate(toVersion);
		})
		.then(function() {
			debug('Creating migration tasks');

			var upMigrationTasks = [];
			var downMigrationTasks = [];

			var migrationNames = [];

			// Now check the copied models and figure out what to migrate
			newModels.forEach(function(newModel) {
				debug('Checking model ' + newModel.getName() + ' on ' + newModel.models.tag);

				var oldModel = oldModels.findModel(newModel.getName());

				if(!oldModel) {
					//create newModel, easy
					migrationNames.push('create', inflection.dasherize(newModel.getName()));

					upMigrationTasks.push(createModelMigrationTask(newModel));
					downMigrationTasks.push(destroyModelMigrationTask(newModel));
				}
				else {
					// Check all properties and see if something changed
					var removedProperties = [];
					var addedProperties = [];
					var changedProperties = [];
					var originalChangedProperties = [];

					var newPropertiesMap = newModel.getAllProperties();
					var oldPropertiesMap = oldModel.getAllProperties();

					var parsedPropertyNames = [];

					Object.keys(newPropertiesMap).forEach(function(propertyName) {
						var oldProperty = oldPropertiesMap[propertyName];
						var newProperty = newPropertiesMap[propertyName];

						if(!oldProperty) {
							addedProperties.push(newProperty);
						}
						else {
							var new_ = propertyTypesToString(newProperty);
							var old = propertyTypesToString(oldProperty);

							if(new_ != old) {
								changedProperties.push(newProperty);
								originalChangedProperties.push(oldProperty);
							}
						}

						parsedPropertyNames.push(propertyName);
					});

					Object.keys(oldPropertiesMap).forEach(function(propertyName) {
						if(parsedPropertyNames.indexOf(propertyName) == -1) {
							removedProperties.push(oldPropertiesMap[propertyName]);
						}
					});

					if(addedProperties.length > 0) {
						migrationNames.push('add', 'to', inflection.dasherize(newModel.getName()));

						upMigrationTasks.push(addPropertiesMigrationTask(newModel, addedProperties));
						downMigrationTasks.push(removePropertiesMigrationTask(newModel, addedProperties));
					}

					if(removedProperties.length > 0) {
						migrationNames.push('remove', 'from', inflection.dasherize(newModel.getName()));

						upMigrationTasks.push(removePropertiesMigrationTask(newModel, removedProperties));
						downMigrationTasks.push(addPropertiesMigrationTask(newModel, removedProperties));
					}

					if(changedProperties.length > 0) {
						migrationNames.push('edit', inflection.dasherize(newModel.getName()));

						upMigrationTasks.push(changePropertiesMigrationTask(newModel, changedProperties));
						downMigrationTasks.push(changePropertiesMigrationTask(newModel, originalChangedProperties));
					}
				}
			});

			if(upMigrationTasks.length > 0 && downMigrationTasks.length > 0) {
				var version = (parseInt(toVersion) + 1);
				var migrationFileName;
				if(version == 1) {
					migrationFileName = '1-create-initial-schema.js';
				}
				else {
					migrationFileName = version + '-' + migrationNames.join('-').toLowerCase() + '.js';
				}

				// TODO: Check to see if directory exists.
				var defer = Q.defer();

				fs.mkdir(path.join(basePath, '_migrations'), function() {
					mu.compileAndRender(path.join(__dirname, '..', '..', '..', 'cli', 'templates', 'migration.mu'), {
						migrationName: 'Migration',
						upTasks: function() {
							return upMigrationTasks.map(function(contents) {
								return {contents: contents};
							});
						},
						downTasks: function() {
							return downMigrationTasks.map(function(contents) {
								return {contents: contents};
							});
						}
					})
					.pipe(fs.createWriteStream(path.join(basePath, '_migrations', migrationFileName)))
					.on('end', function() {
						console.log('Created migration file at `' + migrationFileName + '`.');

						defer.resolve();
					});
				});

				return defer.promise;
			}
			else {
				console.log('Your local migrations are up-to-date.');
			}
		})
		.fail(function(error) {
			console.log(error);
			console.log(error.stack);
		});
};