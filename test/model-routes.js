/* global describe, beforeEach, afterEach, before, it */
'use strict';

var request = require('supertest');
var Q = require('q');
var assert = require('assert');
var uuid = require('node-uuid');
var helper = require('./support/helper');

describe('model routes', function() {
	beforeEach(helper.beforeEach({migrate: true}));
	afterEach(helper.afterEach());

	describe('authentication session', function() {
		var agent = null;

		before(function() {
			helper.setup = function(app) {
				function User() {
					this.name 		= [this.String, this.Authenticate];
					this.actions 	= [this.HasMany(this.models.Action), this.AutoFetch, this.Virtual];
				}
				app.model(User);

				User.prototype.accessControl = function() {
					return {
						canCreate: true
					};
				};

				User.prototype.toJSON = function() {
					return {
						id: this.id,
						name: this.name,
						actions: this.actions
					};
				};

				function Action() {
					this.type = [this.String];
					this.user = [this.BelongsTo(this.models.User), this.Required];
				}
				app.model(Action);

				Action.prototype.toJSON = function() {
					return {
						id: this.id,
						type: this.type
					};
				};
			};
			helper.createModels = null;
		});

		beforeEach(function() {
			assert.notEqual(helper.app, null);
			assert.notEqual(helper.app.HTTPServer.express, null);

			agent = request.agent(helper.app.HTTPServer.express);
		});

		it('can register', function(done) {
			agent.post('/api/users')
				.send({
					name: 'Martijn',
					password: 'test'
				})
				.expect(200, function(error, response) {
					assert.equal(error, null);
					assert.equal(response.body.name, 'Martijn');

					done(error);
				});
		});

		it('can register & authorize', function(done) {
			agent.post('/api/users')
				.send({
					name: 'Martijn',
					password: 'test'
				})
				.expect(200, function(error) {
					assert.equal(error, null);

					agent.post('/api/users/authorize')
						.send({
							name: 'Martijn',
							password: 'test'
						})
						.expect(200, function(err, response) {
							assert.equal(err, null);
							assert.equal(response.body.name, 'Martijn');

							done(err);
						});
				});
		});

		/*
		it('cannot get user', function(done) {
			app.models.User.create({name: 'Martijn', password: 'test'})
				.then(function(user) {
					assert.notEqual(user, null);
					assert.equal(user.id, 1);

					agent.get('/api/users/' + user.id).send().expect(403, function(error, response) {
						console.dir(response.body);
					});
				});
		});
		*/

		describe('authorize', function() {
			beforeEach(function(done) {
				agent.post('/api/users')
					.send(helper.jsonify({
						name: 'Martijn',
						password: 'test'
					}))
					.expect(200, function(error) {
						done(error);
					});
			});

			//
		});
	});

	describe('basic routes', function() {
		before(function() {
			helper.setup = function(app) {
				function Event() {
					this.name = [this.String];
					this.value = [this.Integer];
				}
				app.model(Event);

				Event.prototype.accessControl = function() {
					return {
						canCreate: true,
						canUpdate: true,
						canRead: true
					};
				};

				Event.prototype.toJSON = function() {
					return {
						id: this.id,
						name: this.name,
						value: this.value
					};
				};
			};
		});

		it('can create model', function(done) {
			request(helper.app.HTTPServer.express)
				.post('/api/events')
				.send({
					name: 'Martijn'
				})
				.expect(200, function(error, response) {
					assert.equal(error, null);
					assert.equal(response.body.name, 'Martijn');
					assert.equal(Object.keys(response.body).length, 3);

					done();
				});
		});

		describe('create multiple models', function() {
			var model1ID = uuid.v4();
			var model2ID = uuid.v4();
			var model3ID = uuid.v4();

			function createModel(map) {
				var defer = Q.defer();

				request(helper.app.HTTPServer.express)
					.post('/api/events')
					.send(map)
					.expect(200, function(error, response) {
						if(error) {
							defer.reject(error);
						}
						else {
							defer.resolve(response.body);
						}
					});

				return defer.promise;
			}

			beforeEach(function(done) {
				Q.all([
					createModel({
						id: model1ID,
						name: 'Martijn 1',
						value: 1
					}),
					createModel({
						id: model2ID,
						name: 'Martijn 2',
						value: 2
					}),
					createModel({
						id: model3ID,
						name: 'Martijn 3',
						value: 2
					})
				]).then(function() {
					done();
				});
			});

			it('can get 1 model', function(done) {
				request(helper.app.HTTPServer.express)
					.get('/api/events/' + model2ID)
					.expect(200, function(error, response) {
						assert.equal(error, null);
						assert.equal(response.body.name, 'Martijn 2');
						assert.equal(response.body.value, 2);

						done();
					});
			});

			it('can get an array of 1 model', function(done) {
				request(helper.app.HTTPServer.express)
					.get('/api/events?value=1')
					.expect(200, function(error, response) {
						assert.equal(error, null);

						var models = response.body;

						assert.equal(models.length, 1);
						assert.equal(models[0].name, 'Martijn 1');
						assert.equal(models[0].value, 1);

						done();
					});
			});

			it('can get an array of multiple models', function(done) {
				request(helper.app.HTTPServer.express)
					.get('/api/events?value=2')
					.expect(200, function(error, response) {
						assert.equal(error, null);

						var models = response.body;

						assert.equal(models.length, 2);
						assert.equal(models[0].name, 'Martijn 2');
						assert.equal(models[0].value, 2);

						assert.equal(models[1].name, 'Martijn 3');
						assert.equal(models[1].value, 2);

						done();
					});
			});

			it('can update 1 model', function(done) {
				request(helper.app.HTTPServer.express)
					.put('/api/events/' + model3ID)
					.send({
						name: 'Martijn (Updated)'
					})
					.expect(200, function(error, response) {
						assert.equal(error, null);
						assert.equal(response.body.id, model3ID);
						assert.equal(response.body.name, 'Martijn (Updated)');
						assert.equal(response.body.value, 2);

						done();
					});
			});

			it('cannot update all models', function(done) {
				request(helper.app.HTTPServer.express)
					.put('/api/events')
					.send(helper.jsonify({
						name: 'Oopsie'
					}))
					.expect(404, function(error) {
						done(error);
					});
			});
		});
	});
});
