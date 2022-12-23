const express = require('express');
const router = new express.Router();
const auth = require('../authentication/authorization');
const SchemaData = require('../models/schemas');
const Matcher = require('../models/matchers');
const Projects = require('../models/projects');
const OperationData = require('../models/operationData');
const findAttributeTableDetails = require('../utility/findAttributeTableDetails');
const UserOvrrdMatches = require('../models/userOvrrdMatches');
const errorMessages = require('../utility/errorMessages');

router.post('/recommendations', auth, async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let schemaName = req.body.schema;
		let requiredAttribute = req.body.attribute;

		// get path
		let schemaData = await SchemaData.findOne({
			projectid: projectId,
			'data.name': schemaName
		});
		if (!schemaData) {
			throw new Error(404).send(errorMessages.SCHEMA_NOT_FOUND);
		}

		schemaData = schemaData.toObject();

		let allAttributes = schemaData.data.attributes;
		let att = allAttributes.find((item) => item.name == requiredAttribute);

		if (!att) {
			throw new Error(errorMessages.ATTRIBUTE_NOT_FOUND);
		}

		let path = getPath(schemaName, att);
		let level = att.level;

		// get recommendations
		let matches = await Matcher.find({ projectid: projectId, schema: schemaName });

		if (!matches) {
			throw new Error(errorMessages.MATCH_DATA_NOT_FOUND);
		}

		let recommendations = getRecommendationByAttName(matches, requiredAttribute);

		let param = {
			projectId,
			schemaName,
			schemaAttribute: requiredAttribute,
			attributePath: path
		};

		let overridenMatch = await getOverriddenMatch(param);
		const expectedResponse = {
			name: requiredAttribute,
			path,
			level,
			recommendations,
			overridenMatch
		};

		res.status(200).send(expectedResponse);
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

router.post('/schemaRecommendations', auth, async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let schemaName = req.body.schema;

		let schemaData = await SchemaData.findOne({
			projectid: projectId,
			'data.name': schemaName
		});

		if (!schemaData) {
			throw new Error(errorMessages.SCHEMA_NOT_FOUND);
		}

		schemaData = schemaData.toObject();

		let allAttributes = schemaData.data.attributes;

		// Get path,level for all child attributes
		let requiredAttList = [];
		for (att of allAttributes) {
			if (att.is_child == true) {
				let path = getPath(schemaName, att);
				let data = {
					name: att.name,
					level: att.level,
					path: path
				};

				requiredAttList.push(data);
			}
		}

		// Get recommendations
		let matches = await Matcher.find({ projectid: projectId, schema: schemaName });
		if (!matches) {
			throw new Error(errorMessages.MATCH_DATA_NOT_FOUND);
		}

		//Add recommendation for child attributes
		for (att of requiredAttList) {
			let attName = att.name;
			let recommendations = getRecommendationByAttName(matches, attName);
			att.recommendations = recommendations;

			let param = {
				projectId,
				schemaName,
				schemaAttribute: attName,
				attributePath: att.path
			};

			let overridenMatch = await getOverriddenMatch(param);
			att.overridenMatch = overridenMatch;
		}

		const expectedResponse = requiredAttList;
		res.status(200).send(expectedResponse);
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

router.post('/listAllAttributes', auth, async (req, res) => {
	try {
		const { projectId } = req.body;
		let operationData = await OperationData.find({ projectid: projectId }).lean();
		let requiredList = [];
		if (operationData.length) {
			for (const operation of operationData) {
				const { requestData, responseData } = operation.data;
				const { header, path, query, formData, body } = requestData;
				//for Request Data
				const requestDataList = [header, path, query, formData, body];
				for (const requestField of requestDataList) {
					if (requestField == body && requestField.properties) {
						let requestBodyProperties = Object.keys(requestField.properties);
						//loop through req body
						for (const bodyProperty of requestBodyProperties) {
							const bodyFieldObject = requestField.properties[bodyProperty];
							if (bodyFieldObject.ezapi_ref && bodyFieldObject.name) {
								const schemaData = await SchemaData.findOne({
									projectid: projectId,
									'data.name': bodyFieldObject.name
								}).lean();
								if (schemaData && schemaData.data && schemaData.data.attributes) {
									const attributes = schemaData.data.attributes;
									const schemaName = schemaData.data.name;
									for (const attribute of attributes) {
										let attributeName = attribute.name;
										if (requiredList.length) {
											const duplicateAttribute = requiredList.find(
												(att) =>
													(att.attribute == attributeName ||
														att.schemaAttribute == attributeName) &&
													att.schemaName == schemaName
											);
											if (duplicateAttribute) {
												continue;
											}
										}
										//let attributeName = attribute.name;
										const tableDetailsObject = await findAttributeTableDetails(
											projectId,
											schemaName,
											attributeName,
											operation
										);
										let result = Array.isArray(tableDetailsObject);
										if (result) {
											requiredList.push(...tableDetailsObject);
										} else {
											requiredList.push(tableDetailsObject);
										}
									}
								}
							} else {
								const schemaName = bodyFieldObject.schemaName;
								const attributeName = bodyFieldObject.name;
								if (requiredList.length) {
									const duplicateAttribute = requiredList.find(
										(att) =>
											(att.attribute == attributeName ||
											att.schemaAttribute == attributeName) &&
											att.schemaName == schemaName
									);
									if (duplicateAttribute) {
										continue;
									}
								}
								const tableDetailsObject = await findAttributeTableDetails(
									projectId,
									schemaName,
									attributeName,
									operation
								);
								let result = Array.isArray(tableDetailsObject);
								if (result) {
									requiredList.push(...tableDetailsObject);
								} else {
									requiredList.push(tableDetailsObject);
								}
							}
						}
					} else {
						if (requestField && requestField.length) {
							//Loop through Other request Fields
							for (const property of requestField) {
								let propertyName = Object.keys(property).length
									? Object.keys(property)[0]
									: null;
								if (propertyName) {
									const { schemaName, name: attributeName } =
										property[propertyName];
									if (requiredList.length) {
										const duplicateAttribute = requiredList.find(
											(att) =>
												(att.attribute == attributeName ||
													att.schemaAttribute == attributeName) &&
												att.schemaName == schemaName
										);
										if (duplicateAttribute) {
											continue;
										}
									}
									const tableDetailsObject = await findAttributeTableDetails(
										projectId,
										schemaName,
										attributeName,
										operation
									);
									let result = Array.isArray(tableDetailsObject);
									if (result) {
										requiredList.push(...tableDetailsObject);
									} else {
										requiredList.push(tableDetailsObject);
									}
								}
							}
						}
					}
				}
				//for Response Data
				if (responseData && responseData.length) {
					//loop through all statusCodes responses
					for (const response of responseData) {
						let responseHeaders = response.headers || null;
						//for EachStatusCode response header
						if (responseHeaders) {
							for (const header of responseHeaders) {
								let headerProperty = Object.keys(header)[0];
								const { schemaName, name: attributeName } = header[headerProperty];
								if (requiredList.length) {
									const duplicateAttribute = requiredList.find(
										(att) =>
											(att.attribute == attributeName ||
												att.schemaAttribute == attributeName) &&
											att.schemaName == schemaName
									);
									if (duplicateAttribute) {
										continue;
									}
								}
								const tableDetailsObject = await findAttributeTableDetails(
									projectId,
									schemaName,
									attributeName,
									operation
								);
								let result = Array.isArray(tableDetailsObject);
								if (result) {
									requiredList.push(...tableDetailsObject);
								} else {
									requiredList.push(tableDetailsObject);
								}
							}
						}
						let responseBodyProperties;
						if (response.content && response.content.properties) {
							responseBodyProperties = Object.keys(response.content.properties);
							for (const bodyProperty of responseBodyProperties) {
								const bodyFieldObject = response.content.properties[bodyProperty];
								if (bodyFieldObject.ezapi_ref && bodyFieldObject.name) {
									const schemaData = await SchemaData.findOne({
										projectid: projectId,
										'data.name': bodyFieldObject.name
									}).lean();
									if (
										schemaData &&
										schemaData.data &&
										schemaData.data.attributes
									) {
										const attributes = schemaData.data.attributes;
										const schemaName = schemaData.data.name;
										for (const attribute of attributes) {
											let attributeName = attribute.name;
											if (requiredList.length) {
												const duplicateAttribute = requiredList.find(
													(att) =>
														(att.attribute == attributeName ||
															att.schemaAttribute == attributeName) &&
														att.schemaName == schemaName
												);
												if (duplicateAttribute) {
													continue;
												}
											}
											const tableDetailsObject =
												await findAttributeTableDetails(
													projectId,
													schemaName,
													attributeName,
													operation
												);
											let result = Array.isArray(tableDetailsObject);
											if (result) {
												requiredList.push(...tableDetailsObject);
											} else {
												requiredList.push(tableDetailsObject);
											}
										}
									}
								} else {
									const schemaName = bodyFieldObject.schemaName;
									const attributeName = bodyFieldObject.name;
									if (requiredList.length) {
										const duplicateAttribute = requiredList.find(
											(att) =>
												(att.attribute == attributeName ||
													att.schemaAttribute == attributeName) &&
												att.schemaName == schemaName
										);
										if (duplicateAttribute) {
											continue;
										}
									}
									const tableDetailsObject = await findAttributeTableDetails(
										projectId,
										schemaName,
										attributeName,
										operation
									);
									let result = Array.isArray(tableDetailsObject);
									if (result) {
										requiredList.push(...tableDetailsObject);
									} else {
										requiredList.push(tableDetailsObject);
									}
								}
							}
						}
					}
				}
			}
		}
		if (requiredList.length) {
			/*requiredList = requiredList.filter(
				(value, index, self) =>
					index ===
					self.findIndex(
						(t) =>
							t.schemaName === value.schemaName &&
							t.schemaAttribute === value.schemaAttribute &&
							t.attributePath === value.attributePath
					)
			);*/
			return res.status(200).send(requiredList);
		}
		return res.status(400).send({ message: 'No operation Data' });
	} catch (err) {
		return res.status(400).send({ message: err.message });
	}
});

function getPath(schemaName, attributeData) {
	let parent = attributeData.parent;
	let parentPathStr = parent ? '/' + parent.split('.').join('/') : '';
	let attributeStr = '/' + attributeData.name;
	let path = schemaName + parentPathStr + attributeStr;
	return path;
}

function getRecommendationByAttName(matches, requiredAttribute) {
	let recommendations = [];
	for (matchItem of matches) {
		matchItem = matchItem.toObject();
		let tableName = matchItem.table;
		let attributes = matchItem.attributes;
		for (attributeItem of attributes) {
			if (
				attributeItem.schema_attribute == requiredAttribute &&
				isMatch(attributeItem.match_type)
			) {
				let { table_attribute, match_type } = attributeItem;
				let data = {
					table: tableName,
					table_attribute,
					match_type
				};
				recommendations.push(data);
			}
		}
	}

	return recommendations;
}

async function getOverriddenMatch(params) {
	let overrdData = await UserOvrrdMatches.findOne(params);
	let result = overrdData
		? {
				tableName: overrdData.tableName,
				tableAttribute: overrdData.tableAttribute
		  }
		: {};
	return result;
}

function isMatch(attMatchType) {
	return attMatchType == 'Full' || attMatchType == 'Partial';
}

module.exports = router;
