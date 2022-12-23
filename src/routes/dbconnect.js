const express = require('express');
const router = new express.Router();
const bodyParser = require('body-parser');
const testDBConnection = require('../controllers/testDBConnection');
const auth = require('../authentication/authorization');
const validator = require('../middlewares/validators/middleware');
const schema = require('../middlewares/validators/projects');

router.use(bodyParser.json());

//router.post('/testDBConnection', testDBConnection);
router.post('/testDBConnection', auth, validator(schema.dbdetailSchema), async (req, res) => {
	const { port, username, password, database, host, type } = req.body;
	const sslFlag = req.body.ssl ? req.body.ssl.sslFlag : false;
	const certPath = req.body.ssl ? req.body.ssl.certPath : '';
	const keyPath = req.body.ssl ? req.body.ssl.keyPath : '';
	const rootPath = req.body.ssl ? req.body.ssl.rootPath : '';

	const response = testDBConnection(
		port,
		username,
		password,
		database,
		host,
		type,
		sslFlag,
		certPath,
		keyPath,
		rootPath
	);
	const response1 = async () => {
		const returnResponse = await response;
		if (returnResponse.status === 'success') {
			res.status(200).json({ status: 'success' });
		} else {
			res.status(400).json({ status: 'failure', message: returnResponse.message });
		}
	};
	response1();
});

module.exports = router;
