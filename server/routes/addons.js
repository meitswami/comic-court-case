// Addons Routes
// Handles addon-related endpoints

import express from 'express';
import { query } from '../lib/mysql.js';

const router = express.Router();

// Get all active addons (public endpoint)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM addons';
    const params = [];
    
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY price ASC';
    
    const addons = await query(sql, params);
    
    // Parse JSON features if they're stored as strings
    const formattedAddons = (addons || []).map(addon => {
      let features = addon.features;
      try {
        if (typeof addon.features === 'string') {
          features = JSON.parse(addon.features);
        }
      } catch (e) {
        console.error('Error parsing features:', e);
        features = null;
      }
      
      return {
        ...addon,
        features: features
      };
    });
    
    res.json(formattedAddons);
  } catch (error) {
    console.error('Error fetching addons:', error);
    const errorMessage = error?.message || error?.toString() || 'Failed to fetch addons';
    res.status(500).json({ error: errorMessage });
  }
});

export default router;

