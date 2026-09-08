const CANONICAL_APP_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://zxowxdfhtksevhnjmeyu.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt',
  APP_NAME: 'Gestão de Amamentação',
  ALLOWED_EMAIL: '',
  DEMO_MODE: false
});

window.CANONICAL_APP_CONFIG = CANONICAL_APP_CONFIG;
// Compatibility alias while legacy modules are migrated away from the old global name.
window.DEBORA_APP_CONFIG = CANONICAL_APP_CONFIG;
