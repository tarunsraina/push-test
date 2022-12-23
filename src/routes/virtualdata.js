// **********copyright info*****************************************
// This code is copyright of EZAPI LLC. For further info, reach out to rams@ezapi.ai
// *****************************************************************

const express = require('express')

const apiopsMiddleware = require('../middlewares/apiops')
const virtualController = require('../controllers/virtualController')

const router = express.Router();

router
    .route('/virtual_test')
    .get(apiopsMiddleware.getDbName, virtualController.getVirtualData)

module.exports = router;