const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./database');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
require('dotenv').config();

const app = express();

// Session configuration (ADDED FOR AUTHENTICATION)
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'idn-survey-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Serve static files (ADDED FOR LOGIN PAGE)
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'OK' }));

// ========== AUTHENTICATION ROUTES (NEW) ==========

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  
  // Check if it's an API request
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/login')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  // Redirect to login page
  res.redirect('/login.html');
};

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT * FROM admin_users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Update last login
    await pool.query(
      'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );
    
    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    
    res.json({ success: true, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// ========== YOUR EXISTING ROUTES (WITH AUTH PROTECTION) ==========

// Get data by TLD (PUBLIC - NO AUTH REQUIRED)
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

// Submit survey (PUBLIC - NO AUTH REQUIRED)
app.post('/api/submit-survey', async (req, res) => {
  try {
    console.log('📥 Webhook received from Alchemer');
    console.log('Full Body:', JSON.stringify(req.body, null, 2));
    
    const b = req.body;
    
    // Log all email-related fields
    console.log('🔍 Checking email fields:');
    console.log('  email_id:', b.email_id);
    console.log('  email:', b.email);
    console.log('  emailid:', b.emailid);
    console.log('  your_email_address:', b.your_email_address);
    
    if (!b.cctld) {
      console.log('❌ Missing cctld field');
      return res.status(400).json({ success: false, error: 'TLD required' });
    }
    
    // Handle scripts_offered as array or string
    let scripts = b.scripts_offered;
    if (Array.isArray(scripts)) {
      scripts = scripts.join(', ');
    }
    
    // Determine which email field to use
    const emailToUse = b.email_id || b.email || b.emailid || b.your_email_address || null;
    console.log('📧 Email to be saved:', emailToUse);
    
    const result = await pool.query(
      `INSERT INTO idn_survey_submissions (cctld, email_id, country, organisationname, idn_registrations_supported, scripts_offered, idn_characters_supported, homoglyph_bundling, year_idn_introduced, form_idn_record_registry_db, form_idn_display_ui_registry, form_idn_display_port43_whois, form_idn_display_web_whois, form_idn_display_rdap, idn_whoisrdap_display, unicode_mailbox_permitted, unicode_mailbox_users, unicode_mailbox_formats, guaranteed_eai_support, mail_server_unicode_support, mail_server_unicode_formats, eai_deployment_plans, mta_software, mua_software, registry
