// **********copyright info*****************************************
// This code is copyright of EZAPI LLC. For further info, reach out to rams@ezapi.ai
// *****************************************************************

const express = require('express')

const apiopsMiddleware = require('../middlewares/apiops')
const testResultController = require('../controllers/testResultController')

// const linkedinMiddleware = require('../authentication/validateLinkedinToken')
// const authorizationMiddleware = require('../authentication/authorization')

const router = express.Router();

router
    .route('/test_result')
    .get(apiopsMiddleware.getDbName, testResultController.getTestResult)
    .post(apiopsMiddleware.getDbName, testResultController.addTestResult)

router
    .route('/test_report')
    .get(apiopsMiddleware.getDbName, testResultController.getTestReport)

module.exports = router;