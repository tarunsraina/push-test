const express = require('express')

const apiopsMiddleware = require('../middlewares/apiops')
const testController = require('../controllers/testController')

const router = express.Router();

router
    .route('/testgrid')
    .get(apiopsMiddleware.getDbName, testController.getTestGrid)

router
    .route('/testdata/:test_id')
    .get(apiopsMiddleware.getDbName, testController.getTestDetails)
    .put(apiopsMiddleware.getDbName, testController.updateTestDetails)
    .delete(apiopsMiddleware.getDbName, testController.deleteTest)

router
    .route('/test')
    .post(apiopsMiddleware.getDbName, testController.addNewTest)

module.exports = router;