const router = require('express').Router();

const auth = require('../authentication/authorization');
const VirtualSim = require('../models/virtualSim');

router.post('/simulate', auth, async (req, res) => {
	try {
		const { projectId: projectid, endpoint, httpMethod, operation_id } = req.body;
		if (!projectid || !endpoint || !httpMethod)
			return res.status(400).json({ message: 'Please provide correct values' });
		const filters = {
			projectid,
			endpoint,
			httpMethod,
			operation_id,
			responseStatusCode: '200'
		};
		const data = await VirtualSim.find(filters).lean();
		if (data.length) return res.status(200).json({ data });
		return res.status(400).json({ message: 'No data found' });
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
});

router.get('/virtualData', async (req, res) => {
	try {
		const { projectId: projectid } = req.query;
		if (!projectid) return res.status(400).json({ message: 'No projectId passed' });
		const filters = { projectid, responseStatusCode: '200' };
		const requiredFields = { projectid: 1, httpMethod: 1, endpoint: 1, operation_id: 1 };
		const virtualData = await VirtualSim.find(filters, requiredFields).lean();
		if (virtualData.length) return res.status(200).json({ data: virtualData });
		return res.status(400).json({ message: 'No data found' });
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
});
module.exports = router;
