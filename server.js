// server.js - Complete Stripe backend for Good Dog IQ
const express = require(‘express’);
const stripe = require(‘stripe’)(process.env.STRIPE_SECRET_KEY);
const cors = require(‘cors’);
require(‘dotenv’).config();

const app = express();

// CORS configuration
app.use(cors({
origin: [
‘https://gooddogiq.netlify.app’,
‘http://localhost:3000’,
‘http://localhost:5173’ // Vite dev server
],
credentials: true
}));

// Middleware - Important: Raw body for webhooks, JSON for other routes
app.use(’/api/webhook’, express.raw({ type: ‘application/json’ }));
app.use(express.json());

// Health check endpoint
app.get(’/api/health’, (req, res) => {
res.json({ status: ‘OK’, timestamp: new Date().toISOString() });
});

// Create checkout session
app.post(’/api/create-checkout-session’, async (req, res) => {
try {
const { plan, success_url, cancel_url, user_id, email } = req.body;

```
// Validate required fields
if (!plan || !success_url || !cancel_url) {
  return res.status(400).json({ 
    error: 'Missing required fields: plan, success_url, cancel_url' 
  });
}

// Define price IDs (replace with your actual Stripe Price IDs)
const priceIds = {
  monthly: 'price_1OwnerMonthlyPremium', // Replace with actual price ID
  annual: 'price_1OwnerAnnualPremium'    // Replace with actual price ID
};

const priceId = priceIds[plan];
if (!priceId) {
  return res.status(400).json({ error: 'Invalid plan type' });
}

// Create Stripe checkout session
const session = await stripe.checkout.sessions.create({
  payment_method_types: ['card'],
  line_items: [
    {
      price: priceId,
      quantity: 1,
    },
  ],
  mode: 'subscription',
  success_url: `${success_url}?success=true&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: cancel_url,
  customer_email: email || undefined,
  allow_promotion_codes: true, // Allow promo codes
  metadata: {
    user_id: user_id || 'anonymous',
    plan: plan,
    app: 'gooddogiq'
  },
  subscription_data: {
    metadata: {
      user_id: user_id || 'anonymous',
      plan: plan
    }
  }
});

console.log(`Checkout session created: ${session.id} for user: ${user_id}`);
res.json({ sessionId: session.id });
```

} catch (error) {
console.error(‘Error creating checkout session:’, error);
res.status(500).json({ error: error.message });
}
});

// Create customer portal session for subscription management
app.post(’/api/create-portal-session’, async (req, res) => {
try {
const { customer_id } = req.body;

```
if (!customer_id) {
  return res.status(400).json({ error: 'Customer ID is required' });
}

const portalSession = await stripe.billingPortal.sessions.create({
  customer: customer_id,
  return_url: `${process.env.FRONTEND_URL}/dashboard`,
});

res.json({ url: portalSession.url });
```

} catch (error) {
console.error(‘Error creating portal session:’, error);
res.status(500).json({ error: error.message });
}
});

// Get subscription status
app.get(’/api/subscription-status/:user_id’, async (req, res) => {
try {
const { user_id } = req.params;

```
// In a real app, you'd query your database here
// For now, we'll return a mock response
res.json({
  isPremium: false,
  plan: null,
  customerId: null,
  subscriptionId: null,
  currentPeriodEnd: null
});
```

} catch (error) {
console.error(‘Error fetching subscription status:’, error);
res.status(500).json({ error: error.message });
}
});

// Webhook endpoint to handle Stripe events
app.post(’/api/webhook’, async (req, res) => {
const sig = req.headers[‘stripe-signature’];
let event;

try {
event = stripe.webhooks.constructEvent(
req.body,
sig,
process.env.STRIPE_WEBHOOK_SECRET
);
} catch (err) {
console.log(`Webhook signature verification failed: ${err.message}`);
return res.status(400).send(`Webhook Error: ${err.message}`);
}

console.log(`Received webhook event: ${event.type}`);

// Handle the event
try {
switch (event.type) {
case ‘checkout.session.completed’:
const session = event.data.object;
console.log(`Payment succeeded for session: ${session.id}`);

```
    // Get subscription details
    if (session.mode === 'subscription') {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      
      await handleSubscriptionCreated({
        userId: session.metadata.user_id,
        customerId: session.customer,
        subscriptionId: subscription.id,
        plan: session.metadata.plan,
        status: subscription.status
      });
    }
    break;

  case 'invoice.payment_succeeded':
    const invoice = event.data.object;
    console.log(`Invoice payment succeeded: ${invoice.id}`);
    
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      await handlePaymentSucceeded({
        subscriptionId: subscription.id,
        customerId: invoice.customer,
        amountPaid: invoice.amount_paid / 100, // Convert from cents
        currency: invoice.currency
      });
    }
    break;

  case 'invoice.payment_failed':
    const failedInvoice = event.data.object;
    console.log(`Invoice payment failed: ${failedInvoice.id}`);
    
    await handlePaymentFailed({
      subscriptionId: failedInvoice.subscription,
      customerId: failedInvoice.customer,
      attemptCount: failedInvoice.attempt_count
    });
    break;

  case 'customer.subscription.updated':
    const updatedSubscription = event.data.object;
    console.log(`Subscription updated: ${updatedSubscription.id}`);
    
    await handleSubscriptionUpdated({
      subscriptionId: updatedSubscription.id,
      customerId: updatedSubscription.customer,
      status: updatedSubscription.status,
      cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end
    });
    break;

  case 'customer.subscription.deleted':
    const deletedSubscription = event.data.object;
    console.log(`Subscription cancelled: ${deletedSubscription.id}`);
    
    await handleSubscriptionCancelled({
      subscriptionId: deletedSubscription.id,
      customerId: deletedSubscription.customer,
      userId: deletedSubscription.metadata.user_id
    });
    break;

  default:
    console.log(`Unhandled event type: ${event.type}`);
}

res.json({ received: true });
```

} catch (error) {
console.error(`Error handling webhook ${event.type}:`, error);
res.status(500).json({ error: ‘Webhook handler failed’ });
}
});

// Webhook event handlers
async function handleSubscriptionCreated(data) {
console.log(‘Subscription created:’, data);

// TODO: Update your database
// Example:
// await User.findOneAndUpdate(
//   { _id: data.userId },
//   {
//     isPremium: true,
//     stripeCustomerId: data.customerId,
//     stripeSubscriptionId: data.subscriptionId,
//     plan: data.plan,
//     premiumSince: new Date()
//   }
// );

// For now, just log
console.log(`User ${data.userId} upgraded to premium plan: ${data.plan}`);
}

async function handlePaymentSucceeded(data) {
console.log(‘Payment succeeded:’, data);

// TODO: Log payment in your database
// Update subscription status if needed
}

async function handlePaymentFailed(data) {
console.log(‘Payment failed:’, data);

// TODO: Handle failed payment
// Notify user, send email, etc.

if (data.attemptCount >= 3) {
console.log(`Subscription ${data.subscriptionId} may be cancelled due to failed payments`);
}
}

async function handleSubscriptionUpdated(data) {
console.log(‘Subscription updated:’, data);

// TODO: Update subscription status in your database
if (data.cancelAtPeriodEnd) {
console.log(`Subscription ${data.subscriptionId} will be cancelled at period end`);
}
}

async function handleSubscriptionCancelled(data) {
console.log(‘Subscription cancelled:’, data);

// TODO: Update your database
// Example:
// await User.findOneAndUpdate(
//   { stripeCustomerId: data.customerId },
//   {
//     isPremium: false,
//     stripeSubscriptionId: null,
//     plan: null,
//     cancelledAt: new Date()
//   }
// );

console.log(`User ${data.userId} downgraded to free plan`);
}

// Error handling middleware
app.use((error, req, res, next) => {
console.error(‘Server error:’, error);
res.status(500).json({ error: ‘Internal server error’ });
});

// 404 handler
app.use(’*’, (req, res) => {
res.status(404).json({ error: ‘Endpoint not found’ });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`🚀 Good Dog IQ API server running on port ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Connected' : 'Not configured'}`);
});