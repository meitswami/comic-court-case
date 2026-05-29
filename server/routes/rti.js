// RTI (Right to Information) Routes
// Handles RTI application and tutorial

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, update, generateUUID } from '../lib/mysql.js';

const router = express.Router();

// Get RTI tutorial content (free for ₹50)
router.get('/tutorial', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const language = req.query.language || 'en'; // Get language from query parameter
    const RTI_TUTORIAL_PRICE = 50.00;

    // First check wallet balance
    const wallet = await queryOne(
      'SELECT balance FROM user_wallets WHERE user_id = ?',
      [userId]
    );

    let walletBalance = 0.00;
    if (wallet && wallet.balance !== null && wallet.balance !== undefined) {
      walletBalance = typeof wallet.balance === 'string' 
        ? parseFloat(wallet.balance) 
        : Number(wallet.balance);
    }

    // Check if user has sufficient wallet balance
    const hasSufficientBalance = walletBalance >= RTI_TUTORIAL_PRICE;

    // Also check if user has already purchased this addon (completed payment)
    const payment = await queryOne(
      `SELECT DISTINCT p.* FROM payments p
       JOIN addons a ON JSON_CONTAINS(p.metadata, JSON_OBJECT('addon_id', a.id))
       WHERE p.user_id = ? AND a.code = 'rti-tutorial' AND p.status = 'completed'
       LIMIT 1`,
      [userId]
    );

    const hasAccess = hasSufficientBalance || !!payment;

    if (!hasAccess) {
      return res.status(402).json({ 
        error: 'Payment required',
        message: `This feature requires a payment of ₹${RTI_TUTORIAL_PRICE}. You have ₹${walletBalance.toFixed(2)} in your wallet. Please top up or purchase access.`,
        addon_slug: 'rti-tutorial',
        wallet_balance: walletBalance,
        required_amount: RTI_TUTORIAL_PRICE
      });
    }

    // Get tutorial progress
    const progress = await query(
      'SELECT section_completed, completed_at FROM rti_tutorial_progress WHERE user_id = ? ORDER BY completed_at',
      [userId]
    );

    // Helper function to get translated content
    const getTutorialSections = (lang) => {
      if (lang === 'hi') {
        return [
          {
            id: 'introduction',
            title: 'RTI का परिचय',
            content: `सूचना का अधिकार (RTI) अधिनियम, 2005 एक क्रांतिकारी कानून है जो भारतीय नागरिकों को सार्वजनिक प्राधिकरणों से सूचना प्राप्त करने का अधिकार देता है। यह सरकारी कामकाज में पारदर्शिता और जवाबदेही को बढ़ावा देता है।`,
            keyPoints: [
              'RTI अधिनियम 12 अक्टूबर, 2005 को लागू हुआ',
              'केंद्र और राज्य स्तर पर सभी सार्वजनिक प्राधिकरणों पर लागू',
              'हर नागरिक को सूचना का अधिकार है',
              'सूचना 30 दिनों के भीतर प्रदान की जानी चाहिए',
            ],
          },
          {
            id: 'eligibility',
            title: 'RTI के लिए कौन आवेदन कर सकता है?',
            content: `भारत का कोई भी नागरिक RTI आवेदन दायर कर सकता है। आपको सूचना मांगने का कारण बताने या अपने अनुरोध को उचित ठहराने की आवश्यकता नहीं है।`,
            keyPoints: [
              'भारतीय नागरिक होना चाहिए',
              'सूचना मांगने का कारण बताने की आवश्यकता नहीं',
              'अंग्रेजी, हिंदी या राज्य की आधिकारिक भाषा में आवेदन कर सकते हैं',
              'ऑनलाइन या ऑफलाइन आवेदन कर सकते हैं',
            ],
          },
          {
            id: 'what-information',
            title: 'आप कौन सी सूचना मांग सकते हैं?',
            content: `आप सार्वजनिक प्राधिकरण के पास उपलब्ध किसी भी सूचना का अनुरोध कर सकते हैं। इसमें रिकॉर्ड, दस्तावेज, ईमेल, राय, सलाह, प्रेस विज्ञप्ति, परिपत्र, आदेश, लॉगबुक, अनुबंध, रिपोर्ट, कागज, नमूने, मॉडल, किसी भी इलेक्ट्रॉनिक रूप में रखा गया डेटा सामग्री शामिल है।`,
            keyPoints: [
              'सार्वजनिक प्राधिकरणों के पास रखी कोई भी सूचना',
              'दस्तावेज, रिकॉर्ड, रिपोर्ट, डेटा',
              'निर्णयों और प्रक्रियाओं के बारे में जानकारी',
              'कुछ संवेदनशील सूचनाओं (सुरक्षा, व्यक्तिगत गोपनीयता, आदि) के लिए छूट मौजूद है',
            ],
          },
          {
            id: 'how-to-apply',
            title: 'RTI के लिए कैसे आवेदन करें?',
            content: `आप RTI के लिए दो तरीकों से आवेदन कर सकते हैं: ऑनलाइन (RTI पोर्टल के माध्यम से) या ऑफलाइन (एक लिखित आवेदन जमा करके)।`,
            steps: [
              {
                step: 1,
                title: 'सार्वजनिक प्राधिकरण की पहचान करें',
                description: 'निर्धारित करें कि कौन सा सार्वजनिक प्राधिकरण आपकी मांगी गई सूचना रखता है। यह एक सरकारी विभाग, मंत्रालय, या संगठन हो सकता है।',
              },
              {
                step: 2,
                title: 'अपना आवेदन तैयार करें',
                description: 'एक स्पष्ट आवेदन लिखें जो आपकी आवश्यक सूचना को निर्दिष्ट करे। दस्तावेजों, समय अवधि, और किसी भी प्रासंगिक विवरण के बारे में विशिष्ट रहें।',
              },
              {
                step: 3,
                title: 'शुल्क का भुगतान करें',
                description: 'आवेदन शुल्क का भुगतान करें (केंद्र सरकार के लिए ₹10, राज्य सरकारों के लिए अलग-अलग हो सकता है)। आप ऑनलाइन भुगतान कर सकते हैं या डिमांड ड्राफ्ट/पोस्टल ऑर्डर संलग्न कर सकते हैं।',
              },
              {
                step: 4,
                title: 'आवेदन जमा करें',
                description: 'अपना आवेदन संबंधित विभाग के लोक सूचना अधिकारी (PIO) को जमा करें। अपने रिकॉर्ड के लिए एक प्रति रखें।',
              },
              {
                step: 5,
                title: 'ट्रैक करें और प्रतिक्रिया प्राप्त करें',
                description: 'प्राधिकरण को 30 दिनों के भीतर जवाब देना होगा। आप अपनी आवेदन स्थिति को ऑनलाइन ट्रैक कर सकते हैं या PIO से संपर्क कर सकते हैं।',
              },
            ],
          },
          {
            id: 'fees',
            title: 'RTI आवेदन शुल्क',
            content: `RTI आवेदन के लिए एक नाममात्र शुल्क की आवश्यकता होती है। केंद्र सरकार के विभागों के लिए मानक शुल्क ₹10 है।`,
            keyPoints: [
              'आवेदन शुल्क: ₹10 (केंद्र सरकार)',
              'राज्य शुल्क भिन्न हो सकते हैं (राज्य RTI नियम जांचें)',
              'BPL (गरीबी रेखा से नीचे) कार्डधारक शुल्क से मुक्त हैं',
              'फोटोकॉपी के लिए अतिरिक्त शुल्क लागू हो सकते हैं (₹2 प्रति पृष्ठ)',
            ],
          },
          {
            id: 'appeal',
            title: 'अपील प्रक्रिया',
            content: `यदि आपको सूचना नहीं मिलती है या प्रतिक्रिया से संतुष्ट नहीं हैं, तो आप अपील दायर कर सकते हैं।`,
            keyPoints: [
              'प्रथम अपील: 30 दिनों के भीतर प्रथम अपीलीय प्राधिकरण (FAA) के साथ दायर करें',
              'दूसरी अपील: यदि प्रथम अपील से संतुष्ट नहीं हैं तो सूचना आयोग के साथ दायर करें',
              'प्रथम अपील दायर करने के लिए कोई शुल्क नहीं',
              'अपीलों के निपटान के लिए समय सीमा: 30-45 दिन',
            ],
          },
        ];
      }
      
      // English content (default)
      return [
        {
          id: 'introduction',
          title: 'Introduction to RTI',
          content: `The Right to Information (RTI) Act, 2005 is a revolutionary legislation that empowers Indian citizens to access information from public authorities. It promotes transparency and accountability in government functioning.`,
          keyPoints: [
            'RTI Act came into effect on October 12, 2005',
            'Applies to all public authorities at Central and State levels',
            'Every citizen has the right to request information',
            'Information must be provided within 30 days',
          ],
        },
        {
          id: 'eligibility',
          title: 'Who Can Apply for RTI?',
          content: `Any citizen of India can file an RTI application. You don't need to provide reasons for seeking information or justify your request.`,
          keyPoints: [
            'Must be an Indian citizen',
            'No need to specify the reason for seeking information',
            'Can apply in English, Hindi, or the official language of the state',
            'Can apply online or offline',
          ],
        },
        {
          id: 'what-information',
          title: 'What Information Can You Seek?',
          content: `You can request any information that is available with a public authority. This includes records, documents, emails, opinions, advices, press releases, circulars, orders, logbooks, contracts, reports, papers, samples, models, data material held in any electronic form.`,
          keyPoints: [
            'Any information held by public authorities',
            'Documents, records, reports, data',
            'Information about decisions and processes',
            'Exemptions exist for certain sensitive information (security, personal privacy, etc.)',
          ],
        },
        {
          id: 'how-to-apply',
          title: 'How to Apply for RTI?',
          content: `You can apply for RTI in two ways: Online (through RTI portals) or Offline (by submitting a written application).`,
          steps: [
            {
              step: 1,
              title: 'Identify the Public Authority',
              description: 'Determine which public authority holds the information you seek. This could be a government department, ministry, or organization.',
            },
            {
              step: 2,
              title: 'Draft Your Application',
              description: 'Write a clear application specifying the information you need. Be specific about documents, time periods, and any relevant details.',
            },
            {
              step: 3,
              title: 'Pay the Fee',
              description: 'Pay the application fee (₹10 for Central Government, may vary for State Governments). You can pay online or attach a demand draft/postal order.',
            },
            {
              step: 4,
              title: 'Submit the Application',
              description: 'Submit your application to the Public Information Officer (PIO) of the concerned department. Keep a copy for your records.',
            },
            {
              step: 5,
              title: 'Track and Receive Response',
              description: 'The authority must respond within 30 days. You can track your application status online or contact the PIO.',
            },
          ],
        },
        {
          id: 'fees',
          title: 'RTI Application Fees',
          content: `RTI applications require a nominal fee. The standard fee is ₹10 for Central Government departments.`,
          keyPoints: [
            'Application fee: ₹10 (Central Government)',
            'State fees may vary (check state RTI rules)',
            'BPL (Below Poverty Line) cardholders are exempt from fees',
            'Additional charges may apply for photocopying (₹2 per page)',
          ],
        },
        {
          id: 'appeal',
          title: 'Appeal Process',
          content: `If you don't receive information or are unsatisfied with the response, you can file an appeal.`,
          keyPoints: [
            'First Appeal: File with the First Appellate Authority (FAA) within 30 days',
            'Second Appeal: File with Information Commission if unsatisfied with first appeal',
            'No fee for filing first appeal',
            'Time limit: 30-45 days for disposal of appeals',
          ],
        },
      ];
    };

    const tutorialContent = {
      sections: getTutorialSections(language),
      progress: progress.map((p) => p.section_completed),
    };

    res.json(tutorialContent);
  } catch (error) {
    console.error('Get RTI tutorial error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark tutorial section as completed
router.post('/tutorial/complete', authenticate, async (req, res) => {
  try {
    const { section } = req.body;
    const userId = req.userId;

    if (!section) {
      return res.status(400).json({ error: 'Section ID is required' });
    }

    await insert('rti_tutorial_progress', {
      id: generateUUID(),
      user_id: userId,
      section_completed: section,
    });

    res.json({ success: true, section });
  } catch (error) {
    console.error('Mark tutorial complete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create RTI application
router.post('/application', authenticate, async (req, res) => {
  try {
    const {
      public_authority,
      subject,
      information_requested,
      applicant_name,
      applicant_address,
      applicant_phone,
      applicant_email,
      applicant_pincode,
      payment_id,
    } = req.body;

    const userId = req.userId;

    // Validate required fields
    if (!public_authority || !subject || !information_requested || !applicant_name || !applicant_address) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate application number
    const applicationNumber = `RTI-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const applicationId = generateUUID();

    await insert('rti_applications', {
      id: applicationId,
      user_id: userId,
      application_number: applicationNumber,
      public_authority,
      subject,
      information_requested,
      applicant_name,
      applicant_address,
      applicant_phone: applicant_phone || null,
      applicant_email: applicant_email || null,
      applicant_pincode: applicant_pincode || null,
      payment_id: payment_id || null,
      application_status: payment_id ? 'submitted' : 'draft',
      submitted_at: payment_id ? new Date() : null,
      fee_amount: 10.00,
    });

    const application = await queryOne(
      'SELECT * FROM rti_applications WHERE id = ?',
      [applicationId]
    );

    res.json(application);
  } catch (error) {
    console.error('Create RTI application error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's RTI applications
router.get('/applications', authenticate, async (req, res) => {
  try {
    const userId = req.userId;

    const applications = await query(
      'SELECT * FROM rti_applications WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    res.json(applications);
  } catch (error) {
    console.error('Get RTI applications error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific RTI application
router.get('/application/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const application = await queryOne(
      'SELECT * FROM rti_applications WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json(application);
  } catch (error) {
    console.error('Get RTI application error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit RTI application (after payment)
router.post('/application/:id/submit', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_id, receipt_number } = req.body;
    const userId = req.userId;

    const application = await queryOne(
      'SELECT * FROM rti_applications WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (application.application_status !== 'draft') {
      return res.status(400).json({ error: 'Application already submitted' });
    }

    await update(
      'rti_applications',
      {
        payment_id,
        receipt_number: receipt_number || null,
        application_status: 'submitted',
        submitted_at: new Date(),
      },
      { id }
    );

    const updated = await queryOne(
      'SELECT * FROM rti_applications WHERE id = ?',
      [id]
    );

    res.json(updated);
  } catch (error) {
    console.error('Submit RTI application error:', error);
    res.status(500).json({ error: error.message });
  }
});

// RTI Chat Agent endpoint
router.post('/chat', authenticate, async (req, res) => {
  try {
    const { question, sectionId, sectionContent, language, conversationHistory } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Parse the question for keywords to provide intelligent responses
    const questionLower = question.toLowerCase();
    const isHindi = language === 'hi' || language === 'hinglish';
    
    // Check for common RTI questions and provide contextual answers
    let response = '';
    
    // Fee-related questions
    if (questionLower.includes('fee') || questionLower.includes('cost') || questionLower.includes('charge') || 
        questionLower.includes('paise') || questionLower.includes('kitna') || questionLower.includes('price') ||
        questionLower.includes('amount') || questionLower.includes('dene') || questionLower.includes('dena')) {
      if (isHindi) {
        response = 'RTI आवेदन के लिए शुल्क बहुत कम है। केंद्र सरकार के विभागों के लिए मानक शुल्क ₹10 है। राज्य सरकारों के लिए शुल्क अलग-अलग हो सकते हैं (राज्य RTI नियम जांचें)। BPL (गरीबी रेखा से नीचे) कार्डधारक शुल्क से मुक्त हैं। फोटोकॉपी के लिए अतिरिक्त शुल्क लागू हो सकते हैं (₹2 प्रति पृष्ठ)।';
      } else {
        response = 'RTI application fees are very nominal. The standard fee is ₹10 for Central Government departments. State fees may vary (check state RTI rules). BPL (Below Poverty Line) cardholders are exempt from fees. Additional charges may apply for photocopying (₹2 per page).';
      }
    }
    // Time-related questions
    else if (questionLower.includes('time') || questionLower.includes('day') || questionLower.includes('duration') ||
             questionLower.includes('kitne din') || questionLower.includes('kab') || questionLower.includes('samay')) {
      if (isHindi) {
        response = 'RTI अधिनियम के अनुसार, प्राधिकरण को 30 दिनों के भीतर जवाब देना होगा। यदि आपको सूचना नहीं मिलती है या प्रतिक्रिया से संतुष्ट नहीं हैं, तो आप 30 दिनों के भीतर प्रथम अपील दायर कर सकते हैं। अपीलों के निपटान के लिए समय सीमा 30-45 दिन है।';
      } else {
        response = 'According to the RTI Act, the authority must respond within 30 days. If you don\'t receive information or are unsatisfied with the response, you can file a first appeal within 30 days. Time limit for disposal of appeals is 30-45 days.';
      }
    }
    // Eligibility questions
    else if (questionLower.includes('who') || questionLower.includes('can apply') || questionLower.includes('eligible') ||
             questionLower.includes('kaun') || questionLower.includes('kya') || questionLower.includes('kar sakta')) {
      if (isHindi) {
        response = 'भारत का कोई भी नागरिक RTI आवेदन दायर कर सकता है। आपको सूचना मांगने का कारण बताने या अपने अनुरोध को उचित ठहराने की आवश्यकता नहीं है। आप अंग्रेजी, हिंदी या राज्य की आधिकारिक भाषा में आवेदन कर सकते हैं। आवेदन ऑनलाइन या ऑफलाइन दोनों तरह से किया जा सकता है।';
      } else {
        response = 'Any citizen of India can file an RTI application. You don\'t need to provide reasons for seeking information or justify your request. You can apply in English, Hindi, or the official language of the state. Applications can be made both online and offline.';
      }
    }
    // Section-specific content
    else if (sectionContent?.content) {
      // Use section content to answer
      const sectionText = sectionContent.content.substring(0, 300); // Limit length
      if (isHindi) {
        response = `वर्तमान अनुभाग "${sectionContent.title}" के अनुसार: ${sectionText}${sectionContent.content.length > 300 ? '...' : ''}`;
      } else {
        response = `Based on the current section "${sectionContent.title}": ${sectionText}${sectionContent.content.length > 300 ? '...' : ''}`;
      }
    }
    // Default response
    else {
      if (isHindi) {
        response = 'मैं आपको RTI के बारे में बेहतर समझाने में मदद कर सकता हूं। कृपया सूचना का अधिकार अधिनियम, 2005 या वर्तमान अनुभाग के बारे में विशिष्ट प्रश्न पूछें। आप शुल्क, समय सीमा, पात्रता, या आवेदन प्रक्रिया के बारे में पूछ सकते हैं।';
      } else {
        response = 'I can help you understand RTI better. Please ask specific questions about the Right to Information Act, 2005, or the current section you are viewing. You can ask about fees, time limits, eligibility, or application process.';
      }
    }

    res.json({ 
      response,
      sectionId,
    });
  } catch (error) {
    console.error('RTI chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
