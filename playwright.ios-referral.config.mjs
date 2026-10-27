import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',
  testMatch:'**/referral-ios-session.spec.mjs',
  workers:1,
  fullyParallel:false,
  timeout:60000,
  use:{
    baseURL:'http://127.0.0.1:4173',
    serviceWorkers:'block',
    trace:'retain-on-failure',
    screenshot:'only-on-failure'
  },
  reporter:[['list'],['html',{outputFolder:'artifacts/referral-ios-webkit-report',open:'never'}]],
  outputDir:'artifacts/referral-ios-webkit-results',
  projects:[{name:'iphone-webkit',use:{...devices['iPhone 13'],browserName:'webkit'}}],
  webServer:{
    command:'node tests/e2e/server.mjs',
    url:'http://127.0.0.1:4174',
    reuseExistingServer:false,
    timeout:60000
  }
});
