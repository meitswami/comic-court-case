// Script to add Case Strength Analysis and RTI Tutorial addons to the database

import dotenv from 'dotenv';
import { query, insert } from '../server/lib/mysql.js';

dotenv.config();

async function addAddons() {
  try {
    console.log('📦 Adding Case Strength Analysis and RTI Tutorial addons...\n');

    // Check if addons already exist
    const existingCaseStrength = await query(
      "SELECT * FROM addons WHERE slug = 'case-strength-suggestions'"
    );
    const existingRTI = await query(
      "SELECT * FROM addons WHERE slug = 'rti-tutorial'"
    );

    // Add Case Strength Suggestions addon
    if (existingCaseStrength.length === 0) {
      const caseStrengthId = require('crypto').randomUUID();
      await insert('addons', {
        id: caseStrengthId,
        name: 'Case Strength Improvement Suggestions',
        slug: 'case-strength-suggestions',
        description: 'Get personalized AI-powered suggestions to strengthen your case. Learn what documents and evidence you need to improve your case strength percentage.',
        price: 200.00,
        currency: 'INR',
        category: 'case_analysis',
        features: JSON.stringify([
          'Personalized improvement suggestions',
          'Missing document recommendations',
          'Impact percentage for each suggestion',
          'Estimated case strength after improvements',
          'Priority-based recommendations',
        ]),
        is_active: true,
      });
      console.log('✅ Added Case Strength Suggestions addon (₹200)');
    } else {
      console.log('ℹ️  Case Strength Suggestions addon already exists');
    }

    // Add RTI Tutorial addon
    if (existingRTI.length === 0) {
      const rtiId = require('crypto').randomUUID();
      await insert('addons', {
        id: rtiId,
        name: 'RTI Tutorial & Application',
        slug: 'rti-tutorial',
        description: 'Complete guided tutorial on Right to Information (RTI) Act. Learn how to apply for RTI and apply directly from the platform.',
        price: 50.00,
        currency: 'INR',
        category: 'education',
        features: JSON.stringify([
          'Complete RTI Act tutorial',
          'Step-by-step application guide',
          'Direct RTI application form',
          'Track application progress',
          'Learn about RTI fees and appeals',
        ]),
        is_active: true,
      });
      console.log('✅ Added RTI Tutorial addon (₹50)');
    } else {
      console.log('ℹ️  RTI Tutorial addon already exists');
    }

    console.log('\n✅ All addons added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding addons:', error);
    process.exit(1);
  }
}

addAddons();
