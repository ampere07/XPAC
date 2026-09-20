# AmpereCBMS Backend (Laravel)

Laravel API backend for the Ampere Cloud Business Management System.

## Setup Instructions

### Prerequisites
- PHP 8.0 or higher
- Composer
- MySQL or SQLite database
- Node.js (for npm start command)

### Installation

1. **Install PHP dependencies**:
   ```bash
   composer install
   ```

2. **Environment configuration**:
   ```bash
   cp .env.example .env
   php artisan key:generate
   ```

3. **Configure database** in `.env` file:
   ```
   DB_CONNECTION=mysql
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_DATABASE=ampere_cbms
   DB_USERNAME=your_username
   DB_PASSWORD=your_password
   ```

4. **Run database migrations**:
   ```bash
   php artisan migrate
   ```

5. **Start the server**:
   ```bash
   npm start
   ```
   This runs: `php artisan serve --host=127.0.0.1 --port=8000`

   Alternatively, you can run:
   ```bash
   php artisan serve --port=8000
   ```

## API Endpoints

### Application Management
- `POST /api/application/store` - Submit new application
- `GET /api/applications` - Get all applications (paginated)
- `GET /api/applications/{id}` - Get specific application

### Utility Endpoints
- `GET /api/health` - Health check
- `GET /api/debug` - Debug information and application count
- `POST /api/reset-table` - Reset application table (testing only)

## Database Schema

The main table is `application` with the following key fields:

### Primary Key
- `Application_ID` - Unique 7-digit random integer identifier (replaces auto-incrementing ID)

### Contact Information
- `Email_Address` (unique)
- `Mobile_Number`
- `First_Name`, `Last_Name`, `Middle_Initial`
- `Secondary_Mobile_Number` (nullable)

### Location Details
- `Region` - Philippine region name (not ID)
- `City` - City/municipality name (not ID)
- `Barangay` - Barangay name (not ID)
- `Installation_Address`
- `Landmark`

### Plan and Preferences
- `Desired_Plan`
- `Select_the_applicable_promo`
- `Referred_by` (nullable)

### Document Paths
- `Proof_of_Billing`
- `Government_Valid_ID`
- `2nd_Government_Valid_ID` (nullable)
- `House_Front_Picture`
- `First_Nearest_landmark`
- `Second_Nearest_landmark`

### Status and Metadata
- `Status` (default: 'pending')
- `I_agree_to_the_terms_and_conditions` (boolean)
- `Timestamp` (auto-generated)

## File Upload Configuration

- Upload directory: `public/assets/documents/`
- Supported formats: JPG, PNG, PDF
- Maximum file size: 2MB per file
- Files are renamed with timestamp and unique ID

## Key Features

### Validation
- Email uniqueness check
- Mobile number format validation
- File type and size validation
- Required field validation

### Application ID Generation
- Each application receives a unique 7-digit random integer identifier
- System ensures uniqueness by checking existing IDs before assignment
- No sequential numbering for enhanced security

### Geographic Data Processing
- Accepts region, city, and barangay **names** (not IDs)
- Frontend converts ID selections to names before submission
- Database stores actual location names for better readability

### Error Handling
- Comprehensive validation error messages
- Proper HTTP status codes
- Detailed logging for debugging

## Development Notes

### Migration Management
The application automatically checks for the application table existence and runs migrations if needed.

### Model Usage
The `Application` model is used throughout the controller for database operations instead of raw DB queries.

### Logging
All significant operations are logged to `storage/logs/laravel.log`

### CORS Configuration
Configured to accept requests from `localhost:3000` for frontend integration.

## Troubleshooting

### Database Issues
1. **Migration errors**: Ensure database exists and credentials are correct
2. **Table not found**: Run `php artisan migrate`
3. **Permission denied**: Check database user permissions
4. **Application_ID field changes**: If upgrading from auto-increment to random IDs:
   - Run the migration: `php artisan migrate --path=database/migrations/2025_09_28_000002_change_application_id_to_random.php`
   - This changes Application_ID to support 7-digit random integers
   - May require dropping foreign key constraints first

### File Upload Issues
1. **Directory not found**: Check `public/assets/documents/` exists with proper permissions
2. **File size exceeded**: Verify PHP `upload_max_filesize` and `post_max_size` settings

### API Errors
1. **500 Internal Server Error**: Check `storage/logs/laravel.log` for details
2. **422 Validation Error**: Review validation rules and request data format
3. **CORS issues**: Verify frontend is running on port 3000

## Testing Endpoints

Use these endpoints for testing:

```bash
# Health check
curl http://127.0.0.1:8000/api/health

# Debug info
curl http://127.0.0.1:8000/api/debug

# Reset table (development only)
curl -X POST http://127.0.0.1:8000/api/reset-table
```

## Application ID System

The system generates unique 7-digit random integer IDs for each application:
- **Range**: 1,000,000 to 9,999,999 (7 digits)
- **Storage**: INT(7) database field
- **Security**: Prevents enumeration attacks
- **Uniqueness**: System checks for duplicates before assignment

After changing the database field to INT(7) and updating the code, your application form submissions will receive unique 7-digit random Application IDs.
