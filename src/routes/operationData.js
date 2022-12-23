const express = require('express');
const router = new express.Router();
const request = require('request');

const auth = require('../authentication/authorization');
const OperationData = require('../models/operationData');
const checkUserAccessToProject = require('../middlewares/validators/checkUserAccessToProject');

const openAPIDataTypes = ['integer', 'string', 'boolean', 'number', 'array', 'object'];
const aiServerURL = process.env.AI_SERVER_URL;

router.post(
	'/operationData/sinkRequest/:operationId',
	auth,
	checkUserAccessToProject,
	async (req, res, next) => {
		try {
			const reqAuth = req.body.authorization;
			const operationId = req.params.operationId;
			const reqHeader = req.body.headers;
			const reqPath = req.body.path;
			const reqQuery = req.body.query;
			const reqCookie = req.body.cookie;
			const reqFormData = req.body.formData;
			const endpointURL = req.body.endpoint;

			var headersMap = [];
			var pathMap = [];
			var queryMap = [];
			var formDataMap = [];
			var cookieMap = [];
			var endpoint = '';

			const request = await OperationData.findOne({ id: operationId });
			const body = request.data.requestData;
			endpoint = '/' + req.pathName;

			/* Authorization*/

			body.authorization = {
				authType: 'No Auth',
				tokenType: null
			};
			if (reqAuth && Object.keys(reqAuth).length != 0) {
				if (reqAuth.authType == 'No Auth') {
					reqAuth.tokenType = null;
				} else {
					body.authorization = reqAuth;
				}
			}

			/* Header*/

			body.header = [];
			if (reqHeader && reqHeader.length > 0) {
				for (var i = 0; i < reqHeader.length; i++) {
					var dataMap = await addObjectToArray(reqHeader[i]);
					headersMap.push(dataMap);
				}
				body.header = headersMap;
			}
			/* Path*/

			request.data.endpoint = endpoint; //adding end point when reqPath arr is empty
			body.path = [];
			if (reqPath && reqPath.length > 0) {
				for (var i = 0; i < reqPath.length; i++) {
					var objectType = await getObjectType(reqPath[i]);
					console.log(objectType);
					var dataMap = await addObjectToArray(reqPath[i]);
					pathMap.push(dataMap);
					console.log(reqPath[i]);

					if (objectType === 'column' && !endpointURL) {
						endpoint = endpoint + '/{' + reqPath[i].sourceName + '}';
					} else if (objectType === 'attribute' && !endpointURL) {
						endpoint = endpoint + '/{' + reqPath[i].name + '}';
					}
				}
				request.data.endpoint = endpointURL ? endpointURL : endpoint;
				body.path = pathMap;
			} else {
				request.data.endpoint = endpointURL;
			}

			/* Query */

			body.query = [];
			if (reqQuery && reqQuery.length > 0) {
				for (var i = 0; i < reqQuery.length; i++) {
					var dataMap = await addObjectToArray(reqQuery[i]);
					queryMap.push(dataMap);
				}
				body.query = queryMap;
			}

			/* FormData */

			body.formData = [];
			if (reqFormData && reqFormData.length > 0) {
				for (var i = 0; i < reqFormData.length; i++) {
					var dataMap = await addObjectToArray(reqFormData[i]);
					formDataMap.push(dataMap);
				}
				body.formData = formDataMap;
			}

			/* cookie */

			body.cookie = [];
			if (reqCookie && reqCookie.length > 0) {
				for (var i = 0; i < reqCookie.length; i++) {
					var dataMap = await addObjectToArray(reqCookie[i]);
					cookieMap.push(dataMap);
				}
				body.cookie = cookieMap;
			}

			body.body = await addBody(req.body.body ? req.body.body : []);
			request.save();
			res.status(200).send({ message: true });
		} catch (error) {
			console.log(error);
			next(error);
			return res.status(400).send({ error: error.message });
		}
	}
);

router.post(
	'/operationData/request/:operationId',
	auth,
	checkUserAccessToProject,
	async (req, res) => {
		try {
			const operationId = req.params.operationId;
			const request = await OperationData.findOne({ id: operationId });
			if (!request) {
				res.status(200).send([]);
			} else {
				return res.status(200).send({
					operationId: request.id,
					requestBody: request.data.requestData,
					endpoint: request.data.endpoint
				});
			}
		} catch (error) {
			console.log(error);
			res.status(400).send({ error: error.message });
		}
	}
);

router.post(
	'/operationData/sinkResponse/:operationId',
	auth,
	checkUserAccessToProject,
	async (req, res) => {
		try {
			const operationId = req.params.operationId;
			const response = await OperationData.findOne({ id: operationId });
			const responseBody = req.body.responseData;
			var body = [];

			for (var i = 0; i < responseBody.length; i++) {
				var headersMap = [];
				const headers = responseBody[i].headers;
				if (headers && headers.length > 0) {
					for (var j = 0; j < headers.length; j++) {
						var dataMap = await addObjectToArray(headers[j]);
						headersMap.push(dataMap);
					}
				}

				var data = await addBody(responseBody[i].content ? responseBody[i].content : []);
				var bodyItem = {
					status_code: responseBody[i].status_code,
					description: responseBody[i].description,
					content: data,
					headers: headersMap,
					links: responseBody[i].links
				};
				body.push(bodyItem);
			}
			response.data.responseData = body;
			response.save();
			res.send({ message: true });
		} catch (error) {
			console.log(error);
			res.status(400).send({ error: error.message });
		}
	}
);

router.post(
	'/operationData/response/:operationId',
	auth,
	checkUserAccessToProject,
	async (req, res) => {
		try {
			const operationId = req.params.operationId;
			const response = await OperationData.findOne({ id: operationId });

			if (!response) {
				res.status(200).send([]);
			} else {
				return res.status(200).send({
					operationId: response.id,
					responseBody: response.data.responseData,
					endpoint: response.data.endpoint
				});
			}
		} catch (error) {
			console.log(error);
			res.status(400).send({ error: error.message });
		}
	}
);

router.post('/simulation_artefacts', auth, async (req, res) => {
	try {
		const { projectid } = req.body;
		if (!projectid) return res.status(400).json({ message: 'No projectId' });
		let endpoint = 'simulation_artefacts';
		let url = aiServerURL + '/' + endpoint;
		let options = {
			url: url,
			body: { projectid },
			json: true
		};
		const aiResponse = await request.post(options, async function (err, httpResponse, body) {
			if (!err) res.status(200).json({ response: httpResponse });
			else res.json({ err: err.message });
		});
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
});

router.post('/raw_spec_parser', async (req, res) => {
	try {
		const { projectid } = req.body;
		if (!projectid) return res.status(400).json({ message: 'No projectId' });
		let endpoint = 'raw_spec_parser';
		let url = aiServerURL + '/' + endpoint;
		let options = {
			url: url,
			body: { projectid },
			json: true
		};
		const aiResponse = await request.post(options, async function (err, httpResponse, body) {
			const { statusCode } = httpResponse;
			if (statusCode != 200) {
				return res.status(200).json({ message: 'Ok' });
			}
			if (!err) res.status(httpResponse.statusCode).json({ response: body });
			else res.json({ err: err.message });
		});
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
});
async function getObjectType(object) {
	if (object.paramType) {
		return 'column';
	} else if (openAPIDataTypes.includes(object.type)) {
		return 'attribute';
	}
	return object.type;
}

async function addObject(item) {
	var itemBody;
	var objectType = await getObjectType(item);
	if (objectType === 'attribute') {
		itemBody = {
			payloadId: item.payloadId,
			items: item.items || {},
			name: item.name,
			type: item.type,
			description: item.description,
			required: item.required,
			possibleValues: item.possibleValues,
			format: item.format,
			schemaRef: '#/components/schemas/' + item.schemaName,
			schemaName: item.schemaName,
			isArray: item.isArray || false,
			parentName: item.parentName
		};
	} else if (objectType === 'arrayOfObjects') {
		itemBody = {
			payloadId: item.payloadId,
			items: item.items || {},
			name: item.name,
			type: item.type,
			description: item.description,
			required: item.required,
			format: item.format,
			isArray: item.isArray || false
		};
	} else if (objectType === 'column') {
		itemBody = {
			payloadId: item.payloadId,
			name: item.name,
			sourceName: item.sourceName,
			key: item.key,
			isArray: item.isArray || false,
			required: item.required,
			type: item.type,
			format: item.format,
			paramType: item.paramType,
			tableName: item.tableName
		};
	} else if (objectType === 'ezapi_table') {
		itemBody = {
			payloadId: item.payloadId,
			ezapi_ref: item.sourceName,
			sourceName: item.sourceName,
			key: item.key,
			type: objectType,
			isArray: item.isArray || false,
			ref: item.ref,
			name: item.name ? item.name : item.sourceName,
			selectedColumns: item.selectedColumns
		};
	} else if (objectType === 'storedProcedure') {
		itemBody = {
			name: item.name,
			required: item.required || true,
			inputAttributes: item.inputAttributes || [],
			outputAttributes: item.outputAttributes || [],
			payloadId: item.payloadId,
			isArray: item.isArray || false,
			type: objectType
		};
	} else {
		itemBody = {
			payloadId: item.payloadId,
			ezapi_ref: '#/components/schemas/' + item.name,
			name: item.name,
			isArray: item.isArray || false,
			type: item.type,
			ref: item.ref
		};
	}
	return itemBody;
}

async function addBody(object) {
	var body;
	if (object.length == 1) {
		const dataType = await getObjectType(object[0]);
		if (dataType == 'attribute' || dataType == 'column' || dataType == 'arrayOfObjects') {
			var dataMap = new Map();
			var dataItem = await addObject(object[0]);
			dataMap.set(object[0].name, dataItem);
			body = {
				type: 'object',
				properties: dataMap
			};
		} else {
			body = await addObject(object[0]);
		}
	} else if (object.length > 1) {
		var dataMap = new Map();
		for (var j = 0; j < object.length; j++) {
			// var objectType = await getObjectType(object[j]);
			// console.log(objectType);
			var dataItem = await addObject(object[j]);
			dataMap.set(object[j].name, dataItem);
		}
		body = {
			type: 'object',
			properties: dataMap
		};
	} else {
		body = {};
	}
	return body;
}

async function addObjectToArray(object) {
	var map = new Map();
	var mapItem = {
		payloadId: object.payloadId,
		name: object.name,
		type: object.type,
		commonName: object.commonName,
		description: object.description,
		required: object.required,
		possibleValues: object.possibleValues,
		format: object.format,
		key: object.key
	};
	if (object.paramType) {
		mapItem.paramType = object.paramType;
		mapItem.sourceName = object.sourceName;
		mapItem.tableName = object.tableName;
		mapItem.key = object.key;
	} else if (openAPIDataTypes.includes(object.type)) {
		mapItem.schemaName = object.schemaName;
		mapItem.parentName = object.parentName;
		mapItem.key = object.key;
	}
	map.set(object.name, mapItem);
	return map;
}

module.exports = router;
