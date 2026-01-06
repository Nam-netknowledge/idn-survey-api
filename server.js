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

// Submit survey
app.post('/api/submit-survey', async (req, res) => {
  try {
    const b = req.body;
    if (!b.cctld) return res.status(400).json({ success: false, error: 'TLD required' });
    
    const result = await pool.query(
      `INSERT INTO idn_survey_submissions (cctld, email_id, country, organisationname, idn_registrations_supported, scripts_offered, idn_characters_supported, homoglyph_bundling, year_idn_introduced, form_idn_record_registry_db, form_idn_display_ui_registry, form_idn_display_port43_whois, form_idn_display_web_whois, form_idn_display_rdap, idn_whoisrdap_display, unicode_mailbox_permitted, unicode_mailbox_users, unicode_mailbox_formats, guaranteed_eai_support, mail_server_unicode_support, mail_server_unicode_formats, eai_deployment_plans, mta_software, mua_software, registry_backend_software, idn_spec_version, additional_notes, approval_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, 'pending') RETURNING id`,
      [b.cctld, b.email_id, b.country, b.organisationname, b.idn_registrations_supported, b.scripts_offered, b.idn_characters_supported, b.homoglyph_bundling, b.year_idn_introduced, b.form_idn_record_registry_db, b.form_idn_display_ui_registry, b.form_idn_display_port43_whois, b.form_idn_display_web_whois, b.form_idn_display_rdap, b.idn_whoisrdap_display, b.unicode_mailbox_permitted, b.unicode_mailbox_users, b.unicode_mailbox_formats, b.guaranteed_eai_support, b.mail_server_unicode_support, b.mail_server_unicode_formats, b.eai_deployment_plans, b.mta_software, b.mua_software, b.registry_backend_software, b.idn_spec_version, b.additional_notes]
    );
    res.json({ success: true, submissionId: result.rows[0].id });
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
    await pool.query(`INSERT INTO idn_survey_data (cctld, country, organisationname, email_id, idn_registrations_supported, scripts_offered, idn_characters_supported, homoglyph_bundling, year_idn_introduced, form_idn_record_registry_db, form_idn_display_ui_registry, form_idn_display_port43_whois, form_idn_display_web_whois, form_idn_display_rdap, idn_whoisrdap_display, unicode_mailbox_permitted, unicode_mailbox_users, unicode_mailbox_formats, guaranteed_eai_support, mail_server_unicode_support, mail_server_unicode_formats, eai_deployment_plans, mta_software, mua_software, registry_backend_software, idn_spec_version, additional_notes, approval_status, last_updated) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, 'approved', NOW()) ON CONFLICT (cctld) DO UPDATE SET country = $2, organisationname = $3, approval_status = 'approved', last_updated = NOW()`, [d.cctld, d.country, d.organisationname, d.email_id, d.idn_registrations_supported, d.scripts_offered, d.idn_characters_supported, d.homoglyph_bundling, d.year_idn_introduced, d.form_idn_record_registry_db, d.form_idn_display_ui_registry, d.form_idn_display_port43_whois, d.form_idn_display_web_whois, d.form_idn_display_rdap, d.idn_whoisrdap_display, d.unicode_mailbox_permitted, d.unicode_mailbox_users, d.unicode_mailbox_formats, d.guaranteed_eai_support, d.mail_server_unicode_support, d.mail_server_unicode_formats, d.eai_deployment_plans, d.mta_software, d.mua_software, d.registry_backend_software, d.idn_spec_version, d.additional_notes]);
    await pool.query('UPDATE idn_survey_submissions SET approval_status = $1 WHERE id = $2', ['approved', req.params.submissionId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));
