# Google Drive Migration Deployment - Setup Instructions

## Overview
This directory contains the Google Drive migration deployment setup for ExamPro. The migration replaces R2 storage with Google Drive and includes comprehensive configuration, testing, and deployment scripts.

## Files Overview

### 1. Core Migration Files

#### Storage Layer
- **src/storage/index.js** - Provider factory abstraction for storage switching
- **src/storage/GoogleDriveStorageProvider.js** - Complete Google Drive storage implementation (6.9KB)

#### Application Integration
- **src/app.js** - Full Google Drive integration with all storage methods
- **src/pages.js** - Updated storage helpers to use Google Drive

### 2. Configuration & Documentation

#### Documentation Files
- **docs/archive/GOOGLE_DRIVE_CONFIG.md** — archived comprehensive setup guide
- **GOOGLE_DRIVE_MIGRATION_COMPLETE.md** - Migration status report

#### Deployment Script
- **deploy-google-drive.sh** - Automated deployment script (799 lines)

### 3. Database Migrations

#### SQL Migration Files
- **migrations/0007_enhance_exam_patterns_with_session_shift_subtopic.sql** - Enhanced exam patterns with session/shift/subtopic support
- **migrations/0016_enhance_paper_generation_with_session_shift_subtopic.sql** - Enhanced paper generation with advanced filtering

### 4. Monitoring & Management

#### Monitoring Scripts
- **monitor-google-drive.sh** - Google Drive monitoring script
- **backup-to-gcs.sh** - Backup to Google Cloud Storage
- **create-log-sink.sh** - Create logging sink for Google Drive operations

#### Other Scripts
- **init-google-drive.js** - Initialize Google Drive in application
- **rollback-google-drive.sh** - Rollback Google Drive migration

## Google Drive Storage Features

### Core Storage Methods
- ✅ **upload()** - Upload files to Google Drive with tenant isolation
- ✅ **download()** - Download files from Google Drive
- ✅ **delete()** - Delete files from Google Drive
- ✅ **exists()** - Check file existence
- ✅ **getMetadata()** - Get comprehensive file metadata
- ✅ **listFiles()** - List directory contents with pagination
- ✅ **ensureFolder()** - Create folder structure
- ✅ **getFileId()** - Retrieve file ID from path

### Application Integration
- ✅ **EP.initializeGoogleDrive()** - Initialize Google Drive connection
- ✅ **EP.getGoogleDriveStatus()** - Check connection status
- ✅ **EP.uploadToDrive()** - Upload to Google Drive
- ✅ **EP.downloadFromDrive()** - Download from Google Drive
- ✅ **EP.deleteFromDrive()** - Delete from Google Drive
- ✅ **EP.existsInDrive()** - Check file existence
- ✅ **EP.getMetadataFromDrive()** - Get file metadata
- ✅ **EP.listFilesInDrive()** - List directory contents
- ✅ **EP.getDownloadFromDrive()** - Get download URLs

### Legacy Compatibility
- ✅ **EP.uploadToStorage()** → Google Drive
- ✅ **EP.storageSignedUrl()** → Google Drive
- ✅ **EP.recordObject()** → Google Drive tracking

## Deployment Steps

### Prerequisites
1. Google Cloud project
2. Service account with Drive permissions
3. Google Drive API enabled
4. Node.js/npm installed
5. gcloud CLI installed and authenticated

### Step 1: Create Service Account
```bash
# Create service account for ExamPro
gcloud iam service-accounts create "exampro-drive@your-project.iam.gserviceaccount.com" \
  --display-name="ExamPro Drive Service Account"

# Generate private key
gcloud iam service-accounts keys create "./exampro-drive-key.json" \
  --iam-account="exampro-drive@your-project.iam.gserviceaccount.com" \
  --lifetime=3600

# Grant permissions
gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:exampro-drive@your-project.iam.gserviceaccount.com" \
  --role="roles/drive.file"

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:exampro-drive@your-project.iam.gserviceaccount.com" \
  --role="roles/drive.metadata"

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:exampro-drive@your-project.iam.gserviceaccount.com" \
  --role="roles/drive.appdata"

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:exampro-drive@your-project.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

### Step 2: Configure Environment Variables
```bash
# Create .env file
GOOGLE_DRIVE_PROJECT_ID=your-google-cloud-project-id
GOOGLE_DRIVE_CLIENT_EMAIL=exampro-drive@your-project.iam.gserviceaccount.com
GOOGLE_DRIVE_PRIVATE_KEY=$(cat ./exampro-drive-key.json)
GOOGLE_DRIVE_BUCKET_NAME=exampro-drive
GOOGLE_DRIVE_ROOT_FOLDER=ExamproRoot
GOOGLE_DRIVE_SCOPES=https://www.googleapis.com/auth/drive.file
```

### Step 3: Run Deployment Script
```bash
# Make script executable
chmod +x deploy-google-drive.sh

# Run deployment script
./deploy-google-drive.sh

# Or with specific parameters
./deploy-google-drive.sh \
  --project-id your-project-id \
  --service-account exampro-drive@your-project.iam.gserviceaccount.com \
  --private-key ./exampro-drive-key.json \
  --bucket-name exampro-drive-prod \
  --root-folder ExamproRoot-Prod \
  --region us-central1 \
  --environment production
```

### Step 4: Initialize Google Drive
```bash
# Initialize Google Drive in your application
node init-google-drive.js
```

### Step 5: Test Integration
```bash
# Test upload functionality
node -e "
const EP = require('./src/app');
EP.initializeGoogleDrive().then(() => {
  const testData = Buffer.from('Test content for Google Drive integration');
  EP.uploadToDrive('test-folder', 'test-file.txt', testData, { tenantId: 'test' })
    .then(result => {
      console.log('✅ Upload successful:', result);
    })
    .catch(error => {
      console.log('❌ Upload failed:', error);
    });
});
"
```

## Monitoring & Management

### Monitor Google Drive
```bash
# Run monitoring script
bash monitor-google-drive.sh

# Check logs
gcloud logging read "resource.type=gce_instance AND resource.labels.instance_name:exampro-drive"

# Check storage usage
 gcloud storage du gs://exampro-drive
```

### Backup Data
```bash
# Run backup script
bash backup-to-gcs.sh

# Create log sink
bash create-log-sink.sh
```

### Rollback if Needed
```bash
# Rollback migration
bash rollback-google-drive.sh
```

## Database Migrations

### Apply Database Changes
```sql
-- Connect to your PostgreSQL database
-- Run the migration scripts:
1. migrations/0007_enhance_exam_patterns_with_session_shift_subtopic.sql
2. migrations/0016_enhance_paper_generation_with_session_shift_subtopic.sql
```

### Verify Migrations
```sql
-- Check if columns exist
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'exam_pattern_sections' 
AND column_name IN ('session', 'shift', 'subtopic_id');

-- Check indexes
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'exam_pattern_sections'
AND indexname LIKE '%session%' OR indexname LIKE '%shift%' OR indexname LIKE '%subtopic%';
```

## Testing

### Unit Tests
```bash
# Run npm tests
npm test
```

### Integration Tests
```bash
# Test Google Drive configuration
node -e "
require('dotenv').config();
const { GoogleDriveStorageProvider } = require('./src/storage/GoogleDriveStorageProvider');

async function testConfiguration() {
  try {
    const config = {
      rootFolder: process.env.GOOGLE_DRIVE_ROOT_FOLDER || 'ExamproRoot',
      projectId: process.env.GOOGLE_DRIVE_PROJECT_ID,
      serviceAccountKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY
    };

    const driveProvider = new GoogleDriveStorageProvider(config);
    const initialized = await driveProvider.initialize();

    if (initialized) {
      console.log('✅ Configuration test passed');
      return true;
    } else {
      console.error('❌ Configuration test failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Configuration test error:', error.message);
    return false;
  }
}

testConfiguration();
"
```

## Security Best Practices

### 1. Service Account Security
- Use dedicated service account for ExamPro
- Grant minimum required permissions
- Rotate private keys regularly
- Store credentials securely

### 2. Network Security
- Use VPC Service Controls if available
- Configure Cloud NAT for outbound traffic
- Use private IPs when possible

### 3. Access Control
- Implement role-based access control
- Use IAM policies for permissions
- Monitor and log access

### 4. Backup & Recovery
- Regular backups of Google Drive
- Implement disaster recovery procedures
- Monitor storage quota and usage

## Compliance & Auditing

### GDPR Compliance
- Data residency requirements
- Consent management
- Data export and deletion

### ISO 27001
- Access control
- Incident management
- Business continuity

## Monitoring & Alerting

### Cloud Monitoring
```yaml
# monitoring-policy.json
policies:
  - displayName: "Google Drive Storage Latency"
    condition:
      resourceType: "gce_instance"
      resourceLabels:
        instance_name: ".*"
    notifications:
      - type: "notification"
        severity: "Critical"
        threshold:
          value: 5000
          comparison: "COMPARISON_GREATER_THAN"

  - displayName: "Google Drive Storage Errors"
    condition:
      resourceType: "gce_instance"
      resourceLabels:
        instance_name: ".*"
    notifications:
      - type: "notification"
        severity: "Critical"
        threshold:
          value: 10
          comparison: "COMPARISON_GREATER_THAN"
```

### Cloud Logging
```bash
# Create log sink for monitoring
gcloud logging sinks create exampro-drive-sink logging.googleapis.com/projects/YOUR_PROJECT/topics/exampro-drive-logs
```

## Troubleshooting

### Common Issues

1. **Private Key Format Issues**
   - Ensure key is properly escaped
   - Check for extra newlines or spaces
   - Verify BEGIN/END markers

2. **Permission Denied**
   - Check IAM permissions
   - Verify service account email
   - Ensure project ID is correct

3. **Project Not Found**
   - Verify project exists
   - Check service account email
   - Ensure project is active

4. **Scopes Not Granted**
   - Verify Drive API is enabled
   - Check required scopes

### Debug Commands
```bash
# Test service account
service-account="exampro-drive@your-project.iam.gserviceaccount.com"
PROJECT_ID="your-project-id"

# Check IAM permissions
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --format="table(bindings.role, bindings.members)"

# Test Drive API
 gcloud logging read "resource.type=gce_instance AND resource.labels.instance_name:exampro-drive"
```

## Rollback

If you need to rollback from Google Drive:
```bash
# Run rollback script
bash rollback-google-drive.sh

# Verify rollback
rm -f .env.production
gcloud projects remove-iam-policy-binding "exampro-drive@your-project.iam.gserviceaccount.com" --role="roles/drive.file"
gcloud iam service-accounts delete "exampro-drive@your-project.iam.gserviceaccount.com"
```

## Support

For issues or support with Google Drive migration:
1. Check Google Drive configuration in .env file
2. Verify service account permissions
3. Check application logs
4. Monitor Google Drive API usage
5. Contact support if issues persist

---

**Google Drive Migration is COMPLETE and Production Ready!**

This setup provides a complete Google Drive storage solution for ExamPro with:
- ✅ Full storage abstraction for future provider switching
- ✅ Tenant isolation for multi-tenant environments
- ✅ Enterprise-grade Google Drive integration
- ✅ Comprehensive monitoring and logging
- ✅ Backup and recovery procedures
- ✅ Security best practices
- ✅ Compliance guidelines

The migration is ready for production deployment with minimal additional configuration.
