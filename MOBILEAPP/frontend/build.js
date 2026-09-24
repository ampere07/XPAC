const { execSync } = require('child_process');
const path = require('path');

// App Store Connect API key — used by EAS to set up iOS credentials
// (distribution certificate + provisioning profile) in non-interactive mode.
const p8Path = path.join(__dirname, 'AuthKey_W695AX3KWH.p8');

process.env.EXPO_ASC_API_KEY_PATH = p8Path;
process.env.EXPO_ASC_KEY_ID = "W695AX3KWH";
process.env.EXPO_ASC_ISSUER_ID = "d51b0d4d-88f3-4d65-83e4-8fc55318a946";
process.env.EXPO_APPLE_TEAM_TYPE = "INDIVIDUAL";
process.env.EXPO_APPLE_TEAM_ID = "9TA37RSCJG";

console.log("Starting EAS Build with App Store Connect API Key...");
try {
  execSync('npx eas-cli build -p ios --profile production --non-interactive', { stdio: 'inherit' });
} catch (e) {
  process.exit(1);
}
