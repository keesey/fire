function FireModelInstance(setMap, model) {
	var self = this;
	Object.keys(setMap || {}).forEach(function(propertyName) {
		self[propertyName] = setMap[propertyName];
	});
	this._model = model;
}

function FireModel($http, $q, models) {
	this.$http = $http;
	this.$q = $q;
	this.models = models;
}

FireModel.prototype._action = function(verb, path, fields) {
	var defer = this.$q.defer();

	var self = this;
	this.$http[verb](path, fields)
		.success(function(result) {
			defer.resolve(self.parseResult(result));
		})
		.error(function(data) {
			defer.reject(new Error(data));
		});

	return defer.promise;
};

FireModel.prototype._post = function(path, fields) {
	return this._action('post', path, fields);
};

FireModel.prototype._get = function(path, params) {
	return this._action('get', path, {params:params});
};

FireModel.prototype._put = function(path, fields) {
	return this._action('put', path, fields);
};

FireModel.prototype.update = function(id, model) {
	return this._put(this.endpoint + '/' + id, model);
};

FireModel.prototype.create = function(fields) {
	return this._post(this.endpoint, fields);
};

FireModel.prototype._find = function(path, fields, options) {
	var queryMap = fields || {};

	if(options) {
		queryMap.$options = options;
	}

	return this._get(path, queryMap);
};

FireModel.prototype.find = function(fields, options) {
	return this._find(this.endpoint, fields, options);
};

FireModel.prototype.findOne = function(fields, options) {
	var fieldsMap = fields || {};
	if(fieldsMap.id) {
		var modelID = fieldsMap.id;
		delete fieldsMap.id;

		return this._get(this.endpoint + '/' + fieldsMap.id, fieldsMap);
	}
	else {
		var optionsMap = options || {};
		optionsMap.limit = 1;

		return this.find(fieldsMap, optionsMap)
			.then(function(list) {
				if(list && list.length) {
					return list[0];
				}
				else {
					return null;
				}
			});
	}

};

FireModel.prototype.getOne = function(fields) {
	var defer = this.$q.defer();
	this.findOne(fields)
		.then(function(model) {
			if(model) {
				defer.resolve(model);
			}
			else {
				defer.reject(new Error('Not Found'));
			}
		});
	return defer.promise;
};

{{#models}}
function FireModelInstance{{name}}(setMap, model) {
	FireModelInstance.call(this, setMap, model);
}

{{#associations}}
FireModelInstance{{name}}.prototype.{{methodName}} = function(queryMap, optionsMap) {
	return this._model.models.{{modelName}}._find(this._model.endpoint + '/' + this.id + '/{{associationName}}', queryMap, optionsMap);
	// TPDP: parseResult should return FireModelInstanceComment
};
{{/associations}}

function FireModel{{name}}($http, $q, models) {
	FireModel.call(this, $http, $q, models);

	this.endpoint = '/api/{{resource}}';
}
FireModel{{name}}.prototype = new FireModel();

FireModel{{name}}.prototype.parseResult = function(setMapOrList) {
	if(Object.prototype.toString.call(setMapOrList) === '[object Array]') {
		var self = this;
		return setMapOrList.map(function(setMap) {
			return new FireModelInstance{{name}}(setMap, self);
		});
	}
	else {
		return new FireModelInstance{{name}}(setMapOrList, this);
	}
};

{{#isAuthenticator}}
var __authenticator = null;

FireModel{{name}}.prototype.authorize = function(fields) {
	return this._post(this.endpoint + '/authorize', fields)
		.then(function(authenticator) {
			__authenticator = authenticator;
			return __authenticator;
		});
};

FireModel{{name}}.prototype.getMe = function() {
	var defer = this.$q.defer();

	if(__authenticator) {
		defer.resolve(__authenticator);
	}
	else {
		this._get(this.endpoint + '/me')
			.then(function(authenticator) {
				if(authenticator) {
					__authenticator = authenticator;
					defer.resolve(__authenticator);
				}
				else {
					defer.reject(new Error('Unauthorized'));
				}
			})
			.catch(function(error) {
				defer.reject(error);
			});
	}

	return defer.promise;
};
{{/isAuthenticator}}
{{/models}}

app.service('FireModels', ['$http', '$q', function($http, $q) {
	{{#models}}
	this.{{name}} = new FireModel{{name}}($http, $q, this);
	{{/models}}
}]);