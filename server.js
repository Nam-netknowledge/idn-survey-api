const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./database');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'],
  credentials: false
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'OK' }));

// Get data by TLD
app.get('/api/idn-data/:cctld', async (req, res) => {
  try {
    const { cctld } = req.params;
    const result = await pool.query(
      'SELECT * FROM idn_survey_data WHERE LOWER(cctld) = LOWER($1)',
      [cctld]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'TLD not found' });
    }
    const data = result.rows[0];
    delete data.email_id;
    delete data.created_at;
    delete data.last_updated;
    res.json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit survey - WITH LOGGING
app.post('/api/submit-survey', async (req, res) => {
  try {
    console.log('📥 Webhook received from Alchemer');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const b = req.body;
    
    if (!b.cctld) {
      console.log('❌ Missing cctld field');
      return res.status(400).json({ success: false, error: 'TLD required' });
    }
    
    // Handle scripts_offered as array or string
    let scripts = b.scripts_offered;
    if (Array.isArray(scripts)) {
      scripts = scripts.join(', ');
    }
    
    const result = await pool.query(
      `INSERT INTO idn_survey_submissions (cctld, email_id, country, organisationname, idn_registrations_supported, scripts_offered, idn_characters_supported, homoglyph_bundling, year_idn_introduced, form_idn_record_registry_db, form_idn_display_ui_registry, form_idn_display_port43_whois, form_idn_display_web_whois, form_idn_display_rdap, idn_whoisrdap_display, unicode_mailbox_permitted, unicode_mailbox_users, unicode_mailbox_formats, guaranteed_eai_support, mail_server_unicode_support, mail_server_unicode_formats, eai_deployment_plans, mta_software, mua_software, registry_backend_software, idn_spec_version, additional_notes, approval_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, 'pending') RETURNING id`,
      [
        b.cctld,
        b.email_id || null,
        b.country || null,
        b.organisationname || null,
        b.idn_registrations_supported || null,
        scripts || null,
        b.idn_characters_supported || null,
        b.homoglyph_bundling || null,
        b.year_idn_introduced || null,
        b.form_idn_record_registry_db || null,
        b.form_idn_display_ui_registry || null,
        b.form_idn_display_port43_whois || null,
        b.form_idn_display_web_whois || null,
        b.form_idn_display_rdap || null,
        b.idn_whoisrdap_display || null,
        b.unicode_mailbox_permitted || null,
        b.unicode_mailbox_users || null,
        b.unicode_mailbox_formats || null,
        b.guaranteed_eai_support || null,
        b.mail_server_unicode_support || null,
        b.mail_server_unicode_formats || null,
        b.eai_deployment_plans || null,
        b.mta_software || null,
        b.mua_software || null,
        b.registry_backend_software || null,
        b.idn_spec_version || null,
        b.additional_notes || null
      ]
    );
    
    console.log('✅ Submission saved! ID:', result.rows[0].id);
    res.json({ success: true, submissionId: result.rows[0].id });
  } catch (error) {
    console.error('❌ Error saving submission:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending submissions
app.get('/api/submissions/pending', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM idn_survey_submissions WHERE approval_status = $1 ORDER BY submission_date DESC',
      ['pending']
    );
    res.json({ success: true, count: result.rows.length, submissions: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Approve submission
app.post('/api/approve/:submissionId', async (req, res) => {
  try {
    const sub = await pool.query('SELECT * FROM idn_survey_submissions WHERE id = $1', [req.params.submissionId]);
    if (sub.rows.length === 0) return res.status(404).json({ success: false });
    
    const d = sub.rows[0];
    await pool.query(`INSERT INTO idn_survey_data (cctld, country, organisationname, email_id, idn_registrations_supported, scripts_offered, idn_characters_supported, homoglyph_bundling, year_idn_introduced, form_idn_record_registry_db, form_idn_display_ui_registry, form_idn_display_port43_whois, form_idn_display_web_whois, form_idn_display_rdap, idn_whoisrdap_display, unicode_mailbox_permitted, unicode_mailbox_users, unicode_mailbox_formats, guaranteed_eai_support, mail_server_unicode_support, mail_server_unicode_formats, eai_deployment_plans, mta_software, mua_software, registry_backend_software, idn_spec_version, additional_notes, last_updated) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW()) ON CONFLICT (cctld) DO UPDATE SET country = $2, organisationname = $3, email_id = $4, idn_registrations_supported = $5, scripts_offered = $6, last_updated = NOW()`, [d.cctld, d.country, d.organisationname, d.email_id, d.idn_registrations_supported, d.scripts_offered, d.idn_characters_supported, d.homoglyph_bundling, d.year_idn_introduced, d.form_idn_record_registry_db, d.form_idn_display_ui_registry, d.form_idn_display_port43_whois, d.form_idn_display_web_whois, d.form_idn_display_rdap, d.idn_whoisrdap_display, d.unicode_mailbox_permitted, d.unicode_mailbox_users, d.unicode_mailbox_formats, d.guaranteed_eai_support, d.mail_server_unicode_support, d.mail_server_unicode_formats, d.eai_deployment_plans, d.mta_software, d.mua_software, d.registry_backend_software, d.idn_spec_version, d.additional_notes]);
    await pool.query('UPDATE idn_survey_submissions SET approval_status = $1, reviewed_at = NOW() WHERE id = $2', ['approved', req.params.submissionId]);
    
    console.log('✅ Submission approved and moved to idn_survey_data');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error approving:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Reject submission
app.post('/api/reject/:submissionId', async (req, res) => {
  try {
    const { reason } = req.body;
    await pool.query(
      'UPDATE idn_survey_submissions SET approval_status = $1, rejection_reason = $2, reviewed_at = NOW() WHERE id = $3',
      ['rejected', reason || 'No reason provided', req.params.submissionId]
    );
    console.log('❌ Submission rejected:', req.params.submissionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get submission with comparison to existing data
app.get('/api/submission/:submissionId/compare', async (req, res) => {
  try {
    const submission = await pool.query(
      'SELECT * FROM idn_survey_submissions WHERE id = $1',
      [req.params.submissionId]
    );
    
    if (submission.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    const existing = await pool.query(
      'SELECT * FROM idn_survey_data WHERE LOWER(cctld) = LOWER($1)',
      [submission.rows[0].cctld]
    );
    
    res.json({
      success: true,
      submission: submission.rows[0],
      existing: existing.rows.length > 0 ? existing.rows[0] : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));
