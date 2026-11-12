/**
 * Vercel Web Analytics initialization
 * Documentation: https://vercel.com/docs/analytics/quickstart
 * 
 * This script initializes Vercel Web Analytics using the @vercel/analytics package.
 * The inject() function automatically tracks page views and sets up the analytics client.
 */
import { inject } from '/assets/vercel-analytics-bundle.mjs';

inject();
