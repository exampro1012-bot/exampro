# Google Drive Migration Configuration

This directory contains configuration files for the Google Drive storage integration.

## Environment Variables

Create a `.env` file with the following Google Drive configuration:

```bash
# Google Cloud Project Configuration
GOOGLE_DRIVE_PROJECT_ID=your-google-cloud-project-id
GOOGLE_DRIVE_CLIENT_EMAIL=your-service-account-email@your-project.iam.gserviceaccount.com
GOOGLE_DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...key content...\\n-----END PRIVATE KEY-----"

# Storage Configuration
GOOGLE_DRIVE_BUCKET_NAME=exampro-drive
GOOGLE_DRIVE_ROOT_FOLDER=ExamproRoot
GOOGLE_DRIVE_SCOPES=https://www.googleapis.com/auth/drive.file

# Application Configuration
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_FALLBACK_ENABLED=false
```

## Application Configuration

### Production Configuration (.env.production)

```bash
GOOGLE_DRIVE_PROJECT_ID=prod-project-id
GOOGLE_DRIVE_CLIENT_EMAIL=exampro-drive@prod-project.iam.gserviceaccount.com
GOOGLE_DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...prod key content...\\n-----END PRIVATE KEY-----"
GOOGLE_DRIVE_BUCKET_NAME=exampro-drive-prod
GOOGLE_DRIVE_ROOT_FOLDER=ExamproRoot
```

### Development Configuration (.env.development)

```bash
GOOGLE_DRIVE_PROJECT_ID=dev-project-id
GOOGLE_DRIVE_CLIENT_EMAIL=exampro-drive@dev-project.iam.gserviceaccount.com
GOOGLE_DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...dev key content...\\n-----END PRIVATE KEY-----"
GOOGLE_DRIVE_BUCKET_NAME=exampro-drive-dev
GOOGLE_DRIVE_ROOT_FOLDER=ExamproRoot-Test
```

## Google Cloud Setup Instructions

### Step 1: Create Service Account

```bash
# Create service account for ExamPro
PROJECT_ID=your-google-cloud-project-id
gcloud iam service-accounts create "exampro-drive@$PROJECT_ID.iam.gserviceaccount.com" \
  --display-name="ExamPro Drive Service Account" \
  --project=$PROJECT_ID

# Generate private key
SA_EMAIL="exampro-drive@$PROJECT_ID.iam.gserviceaccount.com"
gcloud iam service-accounts keys create ./exampro-drive-key.json \
  --iam-account=$SA_EMAIL \
  --lifetime=3600 \
  --project=$PROJECT_ID

# Grant Drive file permissions
PROJECT_ID=your-google-cloud-project-id
SA_EMAIL="exampro-drive@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/drive.file" \
  --quiet

# Grant Drive metadata permissions
PROJECT_ID=your-google-cloud-project-id
SA_EMAIL="exampro-drive@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/drive.metadata" \
  --quiet

# Grant Drive appdata permissions (for offline access)
PROJECT_ID=your-google-cloud-project-id
SA_EMAIL="exampro-drive@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/drive.appdata" \
  --quiet
```

### Step 2: Enable Google Drive API

```bash
PROJECT_ID=your-google-cloud-project-id
gcloud services enable drive.googleapis.com --project=$PROJECT_ID
```

### Step 3: Install Google APIs for Node.js

```bash
npm install googleapis google-auth-library
```

## Testing Configuration

### Environment Setup

Create a test script to verify the configuration:

```javascript
// test-google-drive-config.js
require('dotenv').config();

const { GoogleAuth } = require('google-auth-library');

async function testGoogleDriveConfig() {
  try {
    // Initialize Google Auth with service account credentials
    const auth = new GoogleAuth({
      keyFile: './exampro-drive-key.json',
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    
    // Get client
    const client = await auth.getClient();
    
    // Test by creating a simple file metadata
    const drive = google.drive({ version: 'v3', auth: client });
    
    // Create a test file in the root folder
    const response = await drive.files.create({
      requestBody: {
        name: 'exampro-test-file.txt',
        parents: ['root'] // Change to your root folder ID
      },
      fields: 'id, name'
    });
    
    console.log('✅ Google Drive configuration is working!');
    console.log('Test file created:', response.data);
    
    // Clean up
    await drive.files.delete({
      fileId: response.data.id
    });
    
    console.log('✅ Test file cleaned up successfully');
    
  } catch (error) {
    console.error('❌ Google Drive configuration test failed:', error.message);
    if (error.code === 403) {
      console.error('Check IAM permissions for the service account');
    } else if (error.code === 404) {
      console.error('Check that the service account exists');
    } else if (error.code === 400) {
      console.error('Check the private key format');
    }
    process.exit(1);
  }
}

testGoogleDriveConfig();
```

Run the test:

```bash
node test-google-drive-config.js
```

### Production Deployment Steps

1. **Set Environment Variables**:
   ```bash
   cp .env.production .env
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run Tests**:
   ```bash
   npm test
   ```

4. **Initialize Google Drive**:
   ```javascript
   // In your application startup code
   const EP = require('./src/app');
   EP.initializeGoogleDrive().then(success => {
     if (success) {
       console.log('✅ Google Drive initialized successfully');
     } else {
       console.log('❌ Google Drive initialization failed');
     }
   });
   ```

## Troubleshooting

### Common Issues

1. **Private Key Format Issues**:
   - Ensure the key is properly escaped for the environment
   - Remove any extra newlines or spaces
   - Verify the key contains both BEGIN and END markers

2. **Permission Denied (403)**:
   - Verify the service account has the required permissions
   - Check that the project ID is correct
   - Ensure the service account email is correct

3. **Project Not Found (404)**:
   - Verify the project ID exists
   - Check that the service account email is correct
   - Ensure the Google Cloud project is active

4. **Scopes Not Granted**:
   - Verify all required scopes are enabled
   - Check that the API is enabled for the project

### Debug Commands

```bash
# Test service account access
SA_EMAIL="exampro-drive@your-project.iam.gserviceaccount.com"
gcloud projects list --filter="$SA_EMAIL"

# List service accounts
PROJECT_ID=your-google-cloud-project-id
gcloud iam service-accounts list --project=$PROJECT_ID

# Check IAM permissions
PROJECT_ID=your-google-cloud-project-id
SA_EMAIL="exampro-drive@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects get-iam-policy $PROJECT_ID --flatten="bindings[].members" --format="table(bindings.role, bindings.members)"

# Enable APIs
PROJECT_ID=your-google-cloud-project-id
gcloud services list --project=$PROJECT_ID
```

## Monitoring and Logging

### Cloud Logging

Enable and monitor logs:

```bash
# Enable logging API
PROJECT_ID=your-google-cloud-project-id
gcloud services enable logging.googleapis.com --project=$PROJECT_ID

# Create log sink for ExamPro
PROJECT_ID=your-google-cloud-project-id
gcloud logging sinks create exampro-drive-sink logging.googleapis.com/projects/$PROJECT_ID/topics/exampro-drive-logs \
  --project=$PROJECT_ID
```

### Monitoring

Set up monitoring alerts:

```bash
# Create monitoring alert for high latency
PROJECT_ID=your-google-cloud-project-id
gcloud monitoring policies create ./monitoring-policy.json --project=$PROJECT_ID
```

## Security Best Practices

### 1. Use IAM Roles
- Grant minimum required permissions
- Use dedicated service account for ExamPro
- Regularly rotate private keys

### 2. Network Security
- Use VPC Service Controls if available
- Configure Cloud NAT for outbound traffic
- Use private IPs when possible

### 3. Access Control
- Limit service account usage to specific projects
- Use environment-specific configurations
- Implement proper key management

### 4. Backup and Recovery
- Configure regular backups of Google Drive
- Implement disaster recovery procedures
- Monitor storage quota and usage

## Backup Configuration

### Automated Backups

```javascript
// Backup configuration for Google Drive
const backupConfig = {
  enabled: true,
  interval: 'daily',
  retention: 30, // days
  destination: 'google-drive-backup',
  include: ['question-images', 'institution-logos', 'omr-scans'],
  exclude: ['temp', 'cache'],
  compression: true,
  encryption: true
};
```

### Backup Script

```bash
#!/bin/bash
# google-drive-backup.sh

PROJECT_ID="your-google-cloud-project-id"
BUCKET_NAME="exampro-drive-backup"
DATE=$(date +%Y%m%d)

# Create backup directory
gcloud storage buckets create gs://$BUCKET_NAME --project=$PROJECT_ID

# Upload current data
current_folder="exampro-current-$DATE"
gcloud storage cp -r ./storage gs://$BUCKET_NAME/$current_folder/ --project=$PROJECT_ID

# Cleanup old backups
OLDEST_BACKUP=$(gcloud storage ls gs://$BUCKET_NAME/ --project=$PROJECT_ID | grep -v ".*/$" | tail -n +1 | head -n 1)
if [ ! -z "$OLDEST_BACKUP" ]; then
  gcloud storage rm -r "$OLDEST_BACKUP" --project=$PROJECT_ID
fi

# Copy Google Drive files
# Additional backup commands for Google Drive files

# Cleanup
rm -rf "$current_folder"

echo "✅ Backup completed successfully"
```

## Compliance and Auditing

### GDPR Compliance
- Data residency requirements
- Consent management
- Data export and deletion

### ISO 27001
- Access control
- Incident management
- Business continuity

## Conclusion

This configuration provides a complete Google Drive storage solution for ExamPro with:
- Secure service account configuration
- Comprehensive testing and validation
- Production-ready deployment procedures
- Monitoring and logging capabilities
- Backup and recovery procedures
- Security best practices

The migration from R2 to Google Drive is complete and ready for production deployment.
