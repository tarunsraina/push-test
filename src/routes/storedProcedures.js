const router = require('express').Router();

const auth = require('../authentication/authorization');
const StoredProcedures = require('../models/storedProcedures');

router.get('/storedProcedures/:projectId', async (req, res) => {
	try {
		const { projectId } = req.params;
		const data = await StoredProcedures.find({ projectid: projectId });
		return res.status(200).json({ data });
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
});
module.exports = router;
