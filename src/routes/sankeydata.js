// **********copyright info*****************************************
// This code is copyright of EZAPI LLC. For further info, reach out to rams@ezapi.ai
// *****************************************************************

const express = require('express')

const apiopsMiddleware = require('../middlewares/apiops')
const sankeyController = require('../controllers/sankeyController')

// const linkedinMiddleware = require('../authentication/validateLinkedinToken')
// const authorizationMiddleware = require('../authentication/authorization')

const router = express.Router();

router
    .route('/sankey')
    .get(apiopsMiddleware.getDbName, sankeyController.getSankeyData)
// .get(
//     linkedinMiddleware.ValidateLinkedinToken,
//     authorizationMiddleware.authorization,
//     apiopsMiddleware.checkUser,
//     sankeyController.getSankeyData)
// )


module.exports = router;