const express = require('express');
const auth = require('../authentication/authorization');
const shortid = require('shortid');
const request = require('request');
const moment = require('moment');

const User = require('../models/user');
const Products = require('../models/products');
const router = new express.Router();

const { getFormattedUtcDateTime } = require('../utility/utilities');
let sKey = process.env.STRIPE_SECRET_KEY; // STRIPE_SECRET_KEY for testing
const stripe = require('stripe')(sKey);

router.get('/test', (req, res) => {
	res.send('This is from my other router');
});
router.get('/userProfile', auth, async (req, res) => {
	try {
		const { user_id } = req;
		const user = await User.findOne(
			{ user_id },
			{ tokens: 0, linkedinID: 0, linkedinToken: 0 }
		).lean();
		let subscription;
		let subscription_renews_at = null;
		if (user && user.subscription_id) {
			if (!user.subscription_ends_at) {
				subscription = await stripe.subscriptions.retrieve(user.subscription_id);
				subscription_renews_at = subscription.current_period_end
					? moment.unix(subscription.current_period_end).format('MM/DD/YYYY')
					: null;
			}
		}
		const registeredDate = new Date(user.registeredOn);
		const currentDate = new Date(getFormattedUtcDateTime());
		const diffTime = currentDate - registeredDate;
		const diffDays = diffTime / (1000 * 60 * 60 * 24);
		let plan_name = null;
		const product = await Products.findOne({ stripe_product_id: user.subscribed_plan });
		if (product) {
			plan_name = product.plan_name;
		} else {
			if (!(diffDays > 30)) plan_name = 'Trial';
		}
		if (user) {
			return res.status(200).json({ ...user, plan_name, subscription_renews_at });
		}
		return res.status(400).json({ message: 'User not found' });
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
});
// router.get('/users', (req, res) => {
// 	// find() query can be applied to model directly,
// 	// with empty object {} it will return all the data
// 	User.find({})
// 		.then((users) => {
// 			res.status(200).send(users);
// 		})
// 		.catch((error) => {
// 			res.status(400).send(error);
// 		});
// });

// router.get('/users/:id', (req, res) => {
// 	const user_id = req.params.id;
// 	User.findOne({ user_id })
// 		.then((user) => {
// 			if (!user) {
// 				res.status(404).send('No user found');
// 			}
// 			res.status(200).send(user);
// 		})
// 		.catch((error) => {
// 			res.status(500).send(error);
// 		});
// });
module.exports = router;
