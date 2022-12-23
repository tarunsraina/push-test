const express = require('express');
const router = new express.Router();

const checkUserAccessToProject = require('../middlewares/validators/checkUserAccessToProject');
const auth = require('../authentication/authorization');
const Projects = require('../models/projects');
const OperationData = require('../models/operationData');
const Resources = require('../models/resources');
const errorMessages = require('../utility/errorMessages');

router.post('/projectValidate', auth, async (req, res) => {
	const projectId = req.body.projectId;
	const project = await Projects.findOne({ projectId: projectId });
	const resources = project.resources;
	const resourcesIds = [];
	const response = [];
	let atleastOneOpernDataAdded = false;

	for (i = 0; i < resources.length; i++) {
		resourcesIds.push(resources[i].resource);
	}

	for (resourceId of resourcesIds) {
		const resource = await Resources.findOne({ resourceId: resourceId });
		const paths = resource.path;

		for (path of paths) {
			var operations = path.operations;
			for (operation of operations) {
				if (operation.operationId != null) {
					atleastOneOpernDataAdded = true;
					// operationIds.push(operation.operationId);
					let errors = await checkOperation(operation.operationId);
					if (errors.length > 0) {
						var item = {
							resource_name: resource.resourceName,
							path_name: path.pathName,
							operation_name: operation.operationName,
							errors: errors
						};
						response.push(item);
					}
				}
			}
		}
	}
	console.log(response);

	if (!atleastOneOpernDataAdded) {
		let errorMsg = errorMessages.PROJ_WITH_NO_API;
		// formatted as per other error responses
		let err = { errors: [errorMsg] };
		response.push(err);
	}

	res.send({ response: response });
});

async function checkOperation(id) {
	const operation = await OperationData.findOne({ id: id });
	const response = operation.data.responseData;
	var isStatusCode200Exists = false;
	var errors = [];

	for (item of response) {
		if (item.status_code == 200) {
			isStatusCode200Exists = true;
		}
		if (!item.description) {
			let msg = errorMessages.STATUS_CODE_REQUIRES_DESC + item.status_code;
			errors.push(msg);
		}
		if (!item.content) {
			let msg = errorMessages.STATUS_CODE_RESP_BODY + item.status_code;
			errors.push(msg);
		}
	}
	if (!isStatusCode200Exists) {
		let msg = errorMessages.STATUS_CODE_200_REQUIRED;
		errors.push(msg);
	}

	// var responseCode200 = response.find((item) => {
	// 	if (item.status_code == 200) return item;
	// });
	console.log(errors);
	return errors;
}

module.exports = router;
