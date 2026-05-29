// Case Strength Analysis Routes
// Handles case strength analysis and improvement suggestions

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, update } from '../lib/mysql.js';

const router = express.Router();

// Analyze case strength based on uploaded documents
router.post('/analyze/:caseId', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;
    const userId = req.userId;

    // Verify case belongs to user or user is admin
    const caseData = await queryOne(
      'SELECT * FROM cases WHERE id = ? AND (uploaded_by = ? OR ? IN (SELECT id FROM users WHERE role = "admin"))',
      [caseId, userId, userId]
    );

    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    // Get all evidence for this case
    const evidenceList = await query(
      'SELECT * FROM case_evidence WHERE case_id = ?',
      [caseId]
    );

    // Analyze case strength using AI logic
    // For now, we'll use a simple algorithm based on document types and count
    let strengthPercentage = 0;
    const analyzedDocuments = [];
    const documentCategories = new Set();

    // Analyze each evidence document
    for (const evidence of evidenceList) {
      const docType = evidence.file_type || 'unknown';
      const docName = evidence.file_name || '';
      
      let category = 'general';
      let weight = 5; // Default weight

      // Categorize documents and assign weights
      if (docType.includes('pdf') || docType.includes('image')) {
        if (docName.toLowerCase().includes('fir') || docName.toLowerCase().includes('complaint')) {
          category = 'fir';
          weight = 20;
        } else if (docName.toLowerCase().includes('medical') || docName.toLowerCase().includes('hospital')) {
          category = 'medical';
          weight = 15;
        } else if (docName.toLowerCase().includes('contract') || docName.toLowerCase().includes('agreement')) {
          category = 'contract';
          weight = 15;
        } else if (docName.toLowerCase().includes('witness') || docName.toLowerCase().includes('statement')) {
          category = 'witness';
          weight = 12;
        } else if (docName.toLowerCase().includes('evidence') || docName.toLowerCase().includes('proof')) {
          category = 'evidence';
          weight = 10;
        } else if (docName.toLowerCase().includes('id') || docName.toLowerCase().includes('aadhar') || docName.toLowerCase().includes('pan')) {
          category = 'identity';
          weight = 5;
        }
      }

      documentCategories.add(category);
      strengthPercentage += weight;
      analyzedDocuments.push({
        id: evidence.id,
        fileName: evidence.file_name,
        category,
        weight,
        uploadedAt: evidence.created_at,
      });
    }

    // Cap at 100%
    strengthPercentage = Math.min(strengthPercentage, 100);

    // Check if analysis already exists
    const existingAnalysis = await queryOne(
      'SELECT * FROM case_strength_analyses WHERE case_id = ?',
      [caseId]
    );

    const analysisData = {
      case_id: caseId,
      user_id: userId,
      strength_percentage: strengthPercentage,
      analysis_data: JSON.stringify({
        documentCount: evidenceList.length,
        categories: Array.from(documentCategories),
        analyzedAt: new Date().toISOString(),
      }),
      analyzed_documents: JSON.stringify(analyzedDocuments),
    };

    if (existingAnalysis) {
      await update('case_strength_analyses', analysisData, { case_id: caseId });
    } else {
      analysisData.id = require('crypto').randomUUID();
      await insert('case_strength_analyses', analysisData);
    }

    const analysis = await queryOne(
      'SELECT * FROM case_strength_analyses WHERE case_id = ?',
      [caseId]
    );

    res.json({
      ...analysis,
      analysis_data: JSON.parse(analysis.analysis_data),
      analyzed_documents: JSON.parse(analysis.analyzed_documents),
    });
  } catch (error) {
    console.error('Case strength analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get case strength analysis
router.get('/:caseId', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;
    const userId = req.userId;

    const analysis = await queryOne(
      'SELECT * FROM case_strength_analyses WHERE case_id = ?',
      [caseId]
    );

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Verify case belongs to user
    const caseData = await queryOne(
      'SELECT * FROM cases WHERE id = ? AND (uploaded_by = ? OR ? IN (SELECT id FROM users WHERE role = "admin"))',
      [caseId, userId, userId]
    );

    if (!caseData) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      ...analysis,
      analysis_data: JSON.parse(analysis.analysis_data),
      analyzed_documents: JSON.parse(analysis.analyzed_documents),
    });
  } catch (error) {
    console.error('Get case strength error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get improvement suggestions (paid feature - ₹200)
router.post('/suggestions/:caseId', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;
    const userId = req.userId;

    // Verify case belongs to user
    const caseData = await queryOne(
      'SELECT * FROM cases WHERE id = ? AND uploaded_by = ?',
      [caseId, userId]
    );

    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    // Check if user has purchased this addon
    const payment = await queryOne(
      `SELECT DISTINCT p.* FROM payments p
       JOIN addons a ON JSON_CONTAINS(p.metadata, JSON_OBJECT('addon_id', a.id))
       WHERE p.user_id = ? AND a.code = 'case-strength-suggestions' AND p.status = 'completed'
       LIMIT 1`,
      [userId]
    );

    if (!payment) {
      return res.status(402).json({ 
        error: 'Payment required',
        message: 'This feature requires a payment of ₹200. Please purchase the Case Strength Suggestions addon.',
        addon_slug: 'case-strength-suggestions'
      });
    }

    // Get current analysis
    const analysis = await queryOne(
      'SELECT * FROM case_strength_analyses WHERE case_id = ?',
      [caseId]
    );

    if (!analysis) {
      return res.status(404).json({ error: 'Please analyze your case first' });
    }

    const currentStrength = parseFloat(analysis.strength_percentage);
    const analyzedDocs = JSON.parse(analysis.analyzed_documents);

    // Generate suggestions based on missing document categories
    const suggestions = [];
    const categoriesPresent = new Set(analyzedDocs.map((d) => d.category));

    // Missing document suggestions
    const requiredCategories = [
      { name: 'fir', title: 'FIR or Police Complaint', impact: 20, description: 'An FIR or police complaint provides official documentation of the incident.', priority: 'high' },
      { name: 'medical', title: 'Medical Reports', impact: 15, description: 'Medical reports provide evidence of injuries or medical conditions related to the case.', priority: 'high' },
      { name: 'witness', title: 'Witness Statements', impact: 12, description: 'Statements from witnesses who observed the incident strengthen your case significantly.', priority: 'medium' },
      { name: 'contract', title: 'Contract or Agreement Documents', impact: 15, description: 'Original contracts or agreements provide legal evidence of obligations.', priority: 'high' },
      { name: 'evidence', title: 'Photographic or Video Evidence', impact: 10, description: 'Visual evidence such as photos or videos can be crucial in proving your case.', priority: 'medium' },
      { name: 'identity', title: 'Identity Verification Documents', impact: 5, description: 'Valid ID documents help establish the identity of parties involved.', priority: 'low' },
    ];

    for (const category of requiredCategories) {
      if (!categoriesPresent.has(category.name)) {
        const estimatedStrengthAfter = Math.min(currentStrength + category.impact, 100);
        const suggestionId = require('crypto').randomUUID();

        await insert('case_strength_suggestions', {
          id: suggestionId,
          case_id: caseId,
          user_id: userId,
          suggestion_type: 'missing_document',
          title: `Add ${category.title}`,
          description: category.description,
          impact_percentage: category.impact,
          priority: category.priority,
          document_category: category.name,
          estimated_strength_after: estimatedStrengthAfter,
        });

        suggestions.push({
          id: suggestionId,
          type: 'missing_document',
          title: `Add ${category.title}`,
          description: category.description,
          impactPercentage: category.impact,
          priority: category.priority,
          documentCategory: category.name,
          estimatedStrengthAfter,
        });
      }
    }

    // Additional strategy suggestions
    if (currentStrength < 60) {
      const strategyId = require('crypto').randomUUID();
      await insert('case_strength_suggestions', {
        id: strategyId,
        case_id: caseId,
        user_id: userId,
        suggestion_type: 'legal_strategy',
        title: 'Consult with a Legal Expert',
        description: 'Consider consulting with a lawyer to review your case and get professional legal advice on evidence collection.',
        impact_percentage: 15,
        priority: 'high',
        estimated_strength_after: Math.min(currentStrength + 15, 100),
      });

      suggestions.push({
        id: strategyId,
        type: 'legal_strategy',
        title: 'Consult with a Legal Expert',
        description: 'Consider consulting with a lawyer to review your case and get professional legal advice on evidence collection.',
        impactPercentage: 15,
        priority: 'high',
        estimatedStrengthAfter: Math.min(currentStrength + 15, 100),
      });
    }

    res.json({
      currentStrength,
      suggestions,
      totalSuggestions: suggestions.length,
    });
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all suggestions for a case
router.get('/suggestions/:caseId', authenticate, async (req, res) => {
  try {
    const { caseId } = req.params;
    const userId = req.userId;

    const suggestions = await query(
      'SELECT * FROM case_strength_suggestions WHERE case_id = ? AND user_id = ? ORDER BY priority DESC, impact_percentage DESC',
      [caseId, userId]
    );

    res.json(suggestions);
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
