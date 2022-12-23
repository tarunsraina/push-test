const express = require('express');
const router = new express.Router();
const auth = require('../authentication/authorization');
const Parameters = require('../models/parameters');

router.post('/parameters', auth, async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let parameters = await Parameters.find({ api_design_id: projectId });
		if (!parameters) {
			return res.status(404).send('No Parameters found');
		}
		// console.log({ parameters });
		const parametersData = await getParametersData(parameters);
		res.status(200).send({ parameters: parametersData });
	} catch (error) {
		console.log(error);
		res.status(400).send({ error: error.message });
	}
});

async function getParametersData(parameters) {
	let nParameters = [];

	for (parameterItem of parameters) {
		let paramItem = parameterItem.toObject();
		let nParamItem = paramItem.data;
		nParameters.push(nParamItem);
	}

	return nParameters;
}

module.exports = router;
