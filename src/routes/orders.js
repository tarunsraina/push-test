require('dotenv').config();
const express = require('express');
const router = new express.Router();
const shortid = require('shortid');
const moment = require('moment');

const auth = require('../authentication/authorization');
const validator = require('../middlewares/validators/middleware');
const orderReq = require('../middlewares/validators/orders');
const errorMessages = require('../utility/errorMessages');

const { sendEmail } = require('../services/mailing');
const { getFormattedUtcDateTime } = require('../utility/utilities');
const { updatePublishLimit } = require('../utility/updatePublishLimit');

const Projects = require('../models/projects');
const Orders = require('../models/orders');
const Users = require('../models/user');
const bodyParser = require('body-parser');
const Products = require('../models/products');

// ezapi org
const shardInbxEmailId = process.env.SHAREDINBOX_EMAILID;
let sKey = process.env.STRIPE_SECRET_KEY; // STRIPE_SECRET_KEY for testing
const stripeWebHook = process.env.STRIPE_PAYMENT_WEBHOOK; //secret key for testing

const stripe = require('stripe')(sKey);

router.get('/products', auth, async (req, res) => {
	try {
		let { user_id } = req;
		//const user_id = req.get("user_id");
		console.log("user_id", user_id)
		let grpUsr = await Users.findOne({ user_id });
		const { data } = await stripe.prices.list({
			active: true,
			expand: ['data.product']
		});
		const stripePricesList =  data.filter((price) => price.product.active)
		const pricesList = stripePricesList.map((price) => {

			const isDisabled =
				price.product.metadata && price.product.metadata.isDisabled
					? price.product.metadata.isDisabled
					: false;
			
			return {
				isDisabled,
				price_id: price.id,
				product_id: price.product.id,
				plan_name: price.product.name,
				plan_price: price.unit_amount / 100,
				plan_interval: price.recurring.interval
			};
		});
		//let planBenefitsList = await Products.find({ isDisabled: false, group: grpUsr });
		
		if (!grpUsr.group || grpUsr.group == null || grpUsr.group == undefined || grpUsr.group.length == 0) {
			grpUsr.group = "regular"
		}
		const planBenefitsList = await Products.find({ isDisabled: false, group: grpUsr.group });
		planBenefitsList.forEach((planBenefit) => {
			if (planBenefit.stripe_product_id && planBenefit.stripe_product_id.length) {
				pricesList.forEach((price) => {
					if (price.product_id == planBenefit.stripe_product_id) {
						planBenefit.stripe.push(price);
					}
				});
			}
		});
		res.status(200).json({ products: planBenefitsList });
	} catch (error) {
		console.log(error);
		return res.status(400).json(error);
	}
});


router.get('/product/basic', async (req, res) => {
	try {
		let activeBasicPlan = await Products.findOne({ isActive: 1, productRefName: 'basic' });
		res.status(200).send({ product: activeBasicPlan });
	} catch (error) {
		console.log(error);
		return res.status(400).json(error);
	}
});
router.get('/orders', auth, async (req, res) => {
	try {
		let { user_id } = req;
		const user = await Users.findOne({ user_id });
		if (user) {
			const { stripeCustomerId } = user;
			let paymentIntents;
			if (stripeCustomerId && stripeCustomerId.length) {
				paymentIntents = await stripe.paymentIntents.list({
					customer: stripeCustomerId,
					limit: 100
				});
			}
			if (paymentIntents && paymentIntents.data && paymentIntents.data.length) {
				const paymentsList = paymentIntents.data.map((payment_intent) => {
					return {
						amount: payment_intent.amount / 100,
						created: moment.unix(payment_intent.created).format('MM/DD/YYYY'),
						description: payment_intent.description,
						failure_code: payment_intent.charges.data[0].failure_code,
						failure_message: payment_intent.charges.data[0].failure_message,
						id: payment_intent.id,
						receipt_url: payment_intent.charges.data[0].receipt_url,
						payment_status: payment_intent.status
					};
				});
				return res.status(200).json(paymentsList);
			}
			return res.status(200).json([]);
		}
		return res.status(400).json({ message: 'No user found' });
	} catch (error) {
		return res.status(400).json({ message: error.message });
	}
});
router.post('/billing-details', auth, async (req, res) => {
	try {
		let projectId = req.body.projectId;
		let userId = req.user_id;
		let order = await Orders.findOne({ projectId, user: userId });
		let paymentIntent = null;

		// For new order
		if (!order) {
			return res.send({ isDataAvailable: false });
		} else {
			orderId = order.orderId;
			paymentIntentId = order.paymentIntentId;
			paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
			let billingDetails = {};

			if (
				paymentIntent.charges &&
				paymentIntent.charges.data &&
				paymentIntent.charges.data[0]
			) {
				billingDetails = paymentIntent.charges.data[0].billing_details;
			}
			return res.send({ isDataAvailable: true, data: billingDetails });
		}
	} catch (error) {
		return res.send({ error });
	}
});
router.post('/subscribe', auth, async (req, res) => {
	try {
		const { price_id, update_plan } = req.body;
		const { user_id } = req;
		const user = await Users.findOne({ user_id });
		if (user) {
			let { stripeCustomerId: customerId, subscription_id: subscriptionId } = user;
			if (subscriptionId) {
				let subscriptions = await stripe.subscriptions.retrieve(subscriptionId);
				if (subscriptions.plan.id === price_id) {
					return res
						.status(400)
						.json({ message: 'You are already subscribed to this plan.' });
				}
				if (update_plan) {
					const subscription = await stripe.subscriptions.update(subscriptionId, {
						cancel_at_period_end: false,
						payment_behavior: 'error_if_incomplete',
						proration_behavior: 'create_prorations',
						items: [
							{
								id: subscriptions.items.data[0].id,
								price: price_id
							}
						]
					});
					if (subscription && subscription.status === 'active') {
						user.subscribed_plan = subscription.plan.product;
						user.subscribed_price = subscription.plan.id;
						await user.save();
						return res.status(200).json({ message: 'Plan updated successfully' });
					}
					return res.status(400).json({ message: 'Error subscribing to plan' });
				}
				res.status(400).json({ message: 'You are already subscribed to another plan' });
			} else {
				const subscription = await stripe.subscriptions.create({
					customer: customerId,
					items: [{ price: price_id }]
				});
				if (subscription && subscription.status == 'active') {
					const stripe_product_id = subscription.plan.product;
					const product = await Products.findOne({ stripe_product_id });
					if (product.plan_name === 'Basic') {
						user.allowedProjects = product.no_of_projects;
					}
					if (product.plan_name === 'Pro') {
						user.allowedProjects = product.no_of_projects;
					}
					if (product.plan_name === 'POC') {
						user.allowedProjects = product.no_of_projects;
					}
					user.subscribed_plan = stripe_product_id;
					user.subscribed_price = price_id;
					user.subscription_id = subscription.id;
					await user.save();
					return res
						.status(200)
						.json({ message: 'success', subscriptionId: subscription.id });
				}
				if (
					subscription &&
					(subscription.status == 'incomplete' || subscription.status == 'past_due')
				) {
					user.allowedProjects = 0;
					user.subscribed_plan = '';
					user.subscribed_price = '';
					user.subscription_id = '';
					await user.save();
					return res.status(400).json({ message: 'subscription cancelled or failed' });
				}
			}
		}
	} catch (err) {
		res.status(400).json({ message: err.message });
	}
});
router.post('/makeDefaultCard', auth, async (req, res) => {
	try {
		let { user_id } = req;
		let { cardId } = req.body;
		const user = await Users.findOne({ user_id });
		if (user) {
			let stripeCustomerId = user.stripeCustomerId;
			const customer = await stripe.customers.update(stripeCustomerId, {
				invoice_settings: {
					default_payment_method: cardId
				}
			});
			res.status(200).json({ message: 'success', customer });
		}
	} catch (err) {
		res.status(404).json({ message: err.message });
	}
});
router.get('/listCards', auth, async (req, res) => {
	try {
		let { user_id } = req;
		const user = await Users.findOne({ user_id });
		if (user) {
			let stripeCustomerId = user.stripeCustomerId;
			if (!stripeCustomerId) {
				return res.status(200).json({ cards: [] });
			}
			const customer = await stripe.customers.retrieve(stripeCustomerId);
			const { default_payment_method } = customer.invoice_settings;
			const cards = await stripe.customers.listSources(stripeCustomerId, { object: 'card' });
			let n = 0;
			for (var i = 0; i < cards.data.length; i++) {
				if (cards.data[i].id === default_payment_method) {
					cards.data[i].default_card = true;
					break;
				}
			}
			return res.status(200).json(cards);
		} else {
			res.status(400).json('No user Found');
		}
	} catch (err) {
		res.status(400).json({ message: err.message });
	}
});
router.post('/addCard', auth, async (req, res) => {
	try {
		let { stripe_token, billing_address } = req.body;
		let { user_id } = req;
		const user = await Users.findOne({ user_id });
		if (user) {
			let stripeCustomerId = user.stripeCustomerId;
			if (stripeCustomerId && stripeCustomerId.length) {
				const existingCustomer = await stripe.customers.retrieve(stripeCustomerId);
				if (existingCustomer) {
					const card = await stripe.customers.createSource(stripeCustomerId, {
						source: stripe_token
					});
					await stripe.customers.update(stripeCustomerId, {
						address: billing_address,
						invoice_settings: {
							default_payment_method: card.id
						}
					});
					user.billing_address = billing_address;
					await user.save();
					res.status(200).json({ message: 'success', card });
				} else {
					res.status(400).json({ message: 'Invalid Stripe Customer ID' });
				}
			} else {
				const newCustomer = await stripe.customers.create({
					address: billing_address,
					name: user.firstName + ' ' + user.lastName,
					email: user.email,
					metadata: { user_id }
				});
				await stripe.customers.createSource(newCustomer.id, { source: stripe_token });
				user.stripeCustomerId = newCustomer.id;
				user.billing_address = billing_address;
				await user.save();
				res.status(200).json({ message: 'Success' });
			}
		} else {
			throw new Error({ message: 'Invalid User' });
		}
	} catch (error) {
		res.status(400).json({ message: error.message });
	}
});
router.post('/cancelSubscription', auth, async (req, res) => {
	try {
		let { user_id } = req;
		const user = await Users.findOne({ user_id });
		if (user.subscription_ends_at && user.subscription_ends_at.length) {
			const subscriptionEndDate = user.subscription_ends_at;
			return res.status(400).json({
				message: `You have already cancelled subscription and your subscription ends on ${subscriptionEndDate}`
			});
		}
		if (user && user.subscription_id && user.subscription_id.length) {
			const { subscription_id } = user;
			const cancelSubscription = await stripe.subscriptions.update(subscription_id, {
				cancel_at_period_end: true
			});
			if (cancelSubscription && cancelSubscription.cancel_at_period_end) {
				const subscriptionEndDate = moment
					.unix(cancelSubscription.current_period_end)
					.format('MM/DD/YYYY');
				const mailOptions = {
					from: shardInbxEmailId,
					to: user.email,
					subject: 'Subscription Cancelled',
					text: `Hi There!\n\nYour subscription has been cancelled and your subscription ends on ${subscriptionEndDate} .\n\nThanks.`
				};
				sendEmail(mailOptions);
				return res.status(200).json({
					subscription_end_date: subscriptionEndDate,
					message: `Subscription cancelled successfully and your subscription ends on ${subscriptionEndDate}`
				});
			}
			return res.status(400).json({ message: 'Invalid subscription Id' });
		}
		return res.status(400).json({ message: `You haven't subscribed to any plan` });
	} catch (error) {
		return res.status(400).json({ message: error.message });
	}
});
router.post('/initiate-order', auth, async (req, res) => {
	try {
		const { productId, projectId } = req.body;
		// let orderId = req.body.orderId;
		let orderId;
		const product = await Products.findOne({ productId });

		// Validate if already payment can be made for the given project
		let projectData = await Projects.findOne({ projectId });
		if (!projectData) {
			return res.status(404).send({ error: errorMessages.PROJECT_NOT_FOUND });
		} else if (projectData.projectBillingPlan == 'PAID') {
			return res.status(400).send({
				errorType: 'ORDER_NOT_PAYABLE',
				error: errorMessages.ALREADY_PAID
			});
		} else if (projectData.projectBillingPlan == 'FREE') {
			return res.status(400).send({
				errorType: 'ORDER_NOT_PAYABLE',
				error: errorMessages.PROJECT_IS_FREEMIUM
			});
		}

		let projectName = projectData.projectName;

		// Verify and get product data
		if (!product) {
			return res.status(404).send({ error: errorMessages.PRODUCT_NOT_FOUND });
		}

		const userId = req.user_id;
		const user = await Users.findOne({ user_id: userId });

		// Check customer is added to stripe already
		let alreadyExists = false;
		let existingCustomerId = user.stripeCustomerId;
		if (existingCustomerId && existingCustomerId !== '') {
			try {
				let customer = await stripe.customers.retrieve(existingCustomerId);
				alreadyExists = true;
			} catch (error) {
				console.log({ errorType: 'Customer retrievel error', error: error.message });
				alreadyExists = true;
			}
		}

		// Add customer if not already present
		if (!alreadyExists) {
			let customer = await stripe.customers.create({
				name: user.name,
				email: user.email
			});
			//Save customer Id in DB
			user.stripeCustomerId = customer.id;
			await user.save();
		}

		let order = await Orders.findOne({ projectId });
		let paymentIntent = null;

		// For new order
		if (!order) {
			orderId = shortid.generate();

			// Create payment intent
			paymentIntent = await stripe.paymentIntents.create({
				amount: product.price * 100, //amount provided in cents
				currency: product.currency,
				customer: user.stripeCustomerId,
				metadata: {
					userId: userId,
					orderId: orderId,
					projectId: projectId,
					product: product.name
				},
				receipt_email: user.email,
				description: `Purchase for project ${projectName}`
			});

			// Create order data
			let orderData = {
				orderId: orderId,
				projectId: projectId,
				productName: product.name,
				productVersion: product.version,
				productPrice: product.price,
				status: 'initiated',
				user: userId,
				paymentIntentId: paymentIntent.id
			};

			order = new Orders(orderData);
			await order.save();
		} else {
			orderId = order.orderId;
			paymentIntentId = order.paymentIntentId;
			paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
		}

		res.send({
			orderId: orderId,
			clientSecret: paymentIntent.client_secret
		});
	} catch (error) {
		console.log({ error });
		return res.status(400).send({ error });
	}
});
router.post('/update-order', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
	console.log('Listening webhook ', req.body);
	try {
		// Listen to payment intent webhook
		const sig = req.headers['stripe-signature'];
		const body = req.body;
		let endpointSecret = sWebhook;
		let event = null;
		console.log('listening to webhook');

		try {
			event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
		} catch (err) {
			// invalid signature
			console.log({ errorType: 'Invalid signature', err });
			return res.status(400).end();
		}

		let intent = null;
		switch (event['type']) {
			case 'payment_intent.succeeded':
				intent = event.data.object;
				console.log('Succeeded:', intent.id);
				break;
			case 'payment_intent.payment_failed':
				intent = event.data.object;
				const message = intent.last_payment_error && intent.last_payment_error.message;
				console.log('Failed:', intent.id, message);
				break;
		}

		console.log({ intent }); //for debugginng
		//Update order in DB
		const orderId = intent.metadata.orderId;
		const status = intent.status;
		const projectId = intent.metadata.projectId;
		let paid = status == 'succeeded';

		const order = await Orders.findOne({ orderId: orderId });

		order.status = status;
		order.paid = paid;
		if (!paid) {
			let message = intent.last_payment_error ? intent.last_payment_error.message : '';
			order.lastPaymentError = message;
		}
		await order.save();

		//Update project plan
		if (paid) {
			await updateProjectPaidStatus(projectId);
		}
		return res.sendStatus(200);
	} catch (error) {
		console.log({ error });
		res.status(400).send({ error });
	}
});
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
	try {
		const sig = req.headers['stripe-signature'];
		let event;
		const body = req.body;
		let endpointSecret = stripeWebHook;
		event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
		let intent;
		let subscribedPlan;
		let product;
		let interval;
		let user;
		switch (event.type) {
			case 'customer.subscription.created':
			case 'customer.subscription.updated':
				intent = event.data.object;
				subscribedPlan = intent.plan.product;
				interval = intent.plan.interval;
				product = await Products.findOne({ stripe_product_id: subscribedPlan });
				user = await Users.findOne({ stripeCustomerId: intent.customer });
				if (user) {
					if (intent.cancel_at_period_end) {
						const subscription_end_date = moment
							.unix(intent.current_period_end)
							.format('MM/DD/YYYY');
						user.subscription_ends_at = subscription_end_date;
					} else {
						updatePublishLimit(intent.customer);
						if (product) {
							if (interval === 'month') {
								user.allowedProjects = product.no_of_projects;
							}
							if (interval === 'year') {
								user.allowedProjects = product.no_of_projects * 12;
							}
						}
						user.subscription_ends_at = '';
					}
					await user.save();
				}
				break;
			case 'customer.subscription.deleted':
			case 'charge.failed':
				intent = event.data.object;
				user = await Users.findOne({ stripeCustomerId: intent.customer });
				if (user) {
					const registeredDate = new Date(user.registeredOn);
					const currentDate = new Date(getFormattedUtcDateTime());
					const diffTime = currentDate - registeredDate;
					const diffDays = diffTime / (1000 * 60 * 60 * 24);
					user.subscription_id = '';
					user.subscribed_price = '';
					user.subscribed_plan = '';
					user.subscription_ends_at = '';
					if (diffDays > 30) {
						user.allowedProjects = 0;
					}
					await user.save();
				}
				break;
			default:
				console.log(`Unhandled event type ${event.type}`);
		}
		// Return a 200 response to acknowledge receipt of the event
		return res.sendStatus(200);
	} catch (err) {
		res.status(400).send(`Webhook Error: ${err.message}`);
		console.log('error message', err.message);
		return;
	}
});

async function updateProjectPaidStatus(projectId) {
	try {
		//Here we update the project's paid status, and we avoid updating the last updatedAt timestamp
		let resp = await Projects.updateOne(
			{ projectId },
			{ $set: { projectBillingPlan: 'PAID' } },
			{ timestamps: false }
		);
		return resp;
	} catch (error) {
		console.log({ errorAt: 'updateProjectPaidStatus', error: error.message });
		return;
	}
}

module.exports = router;
