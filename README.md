# Institute of Directors-Ghana Membership Database

A professional membership database system for the Institute of Directors-Ghana, featuring a PostgreSQL backend and a modern HTML/CSS/JavaScript frontend.

## Features

- **5 Member Categories**: AIOD (Associates), FIOD (Fellows), MIOD (Members), Honorary Fellows, Corporate Members
- **Subscription Tracking**: Track yearly subscriptions for all member types
- **Good Standing Reports**: Filter and view members with active subscriptions by year
- **CRUD Operations**: Create, Read, Update, Delete members via REST API
- **Export Functionality**: Export data to CSV format
- **Responsive Design**: Professional UI with Montserrat font and deep blue (#12086f) color scheme

## Prerequisites

1. **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
2. **PostgreSQL** (v12 or higher) - [Download here](https://www.postgresql.org/download/)

## Setup Instructions

### Step 1: Install PostgreSQL

1. Install PostgreSQL on your system
2. Remember your postgres user password

### Step 2: Create the Database

1. Open PostgreSQL command line (psql)
2. Create the database:
   ```sql
   CREATE DATABASE iod_ghana;
   ```
3. Connect to the database:
   ```sql
   \c iod_ghana
   ```
4. Run the schema file:
   ```sql
   \i database_schema.sql
   ```
   Or copy and paste the contents of `database_schema.sql` into your PostgreSQL client.

### Step 3: Configure Environment

1. Copy `.env.example` to `.env`:
   ```bash
   copy .env.example .env
   ```
2. Edit `.env` and update the database password:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=iod_ghana
   DB_USER=postgres
   DB_PASSWORD=your_actual_password
   PORT=3000
   ```

For Railway deployment, you can use Railway Postgres instead of local credentials:
   ```
   DATABASE_URL=postgresql://...
   DB_SSL=true
   PORT=3000
   CORS_ORIGIN=https://your-railway-app.up.railway.app
   ADMIN_DEFAULT_USERNAME=admin
   ADMIN_DEFAULT_PASSWORD=choose_a_strong_password
   ```
The server now auto-creates the `admin_users` table on startup, so password changes from the Settings page are stored in PostgreSQL and persist in the cloud database.

### Step 4: Install Dependencies

```bash
npm install
```

### Step 5: Start the Server

```bash
npm start
```

Or for development with auto-restart:
```bash
npm run dev
```

### Step 6: Access the Application

Open your browser and navigate to:
```
http://localhost:3000
```

## Project Structure

```
Database Design/
├── index.html          # Frontend application
├── server.js           # Node.js/Express backend server
├── database_schema.sql # PostgreSQL database schema
├── package.json        # Node.js dependencies
├── .env.example        # Environment configuration template
└── README.md           # This file
```

## API Endpoints

### AIOD Members
- `GET /api/aiod` - Get all AIOD members
- `GET /api/aiod/:id` - Get single AIOD member
- `POST /api/aiod` - Create new AIOD member
- `PUT /api/aiod/:id` - Update AIOD member
- `DELETE /api/aiod/:id` - Delete AIOD member

### FIOD Members
- `GET /api/fiod` - Get all FIOD members
- `GET /api/fiod/:id` - Get single FIOD member
- `POST /api/fiod` - Create new FIOD member
- `PUT /api/fiod/:id` - Update FIOD member
- `DELETE /api/fiod/:id` - Delete FIOD member

### MIOD Members
- `GET /api/miod` - Get all MIOD members
- `GET /api/miod/:id` - Get single MIOD member
- `POST /api/miod` - Create new MIOD member
- `PUT /api/miod/:id` - Update MIOD member
- `DELETE /api/miod/:id` - Delete MIOD member

### Honorary Members
- `GET /api/honorary` - Get all Honorary members
- `GET /api/honorary/:id` - Get single Honorary member
- `POST /api/honorary` - Create new Honorary member
- `PUT /api/honorary/:id` - Update Honorary member
- `DELETE /api/honorary/:id` - Delete Honorary member

### Corporate Members
- `GET /api/corporate` - Get all Corporate members
- `GET /api/corporate/:id` - Get single Corporate member
- `POST /api/corporate` - Create new Corporate member
- `PUT /api/corporate/:id` - Update Corporate member
- `DELETE /api/corporate/:id` - Delete Corporate member

### Statistics & Reports
- `GET /api/statistics` - Get membership statistics
- `GET /api/good-standing/:year` - Get members in good standing for a specific year

### Subscriptions
- `POST /api/:type/:id/subscription` - Add subscription year to a member

## Database Schema

The database includes:
- **5 Member Tables**: `aiod_members`, `fiod_members`, `miod_members`, `honorary_members`, `corporate_members`
- **5 Subscription Tables**: Tracking yearly subscriptions for each member type
- **Functions**: `get_member_statistics()`, `get_good_standing_by_year()`
- **Triggers**: Auto-update timestamps

## Troubleshooting

### Database Connection Error
- Ensure PostgreSQL is running
- Check your `.env` file has correct credentials
- Verify the database `iod_ghana` exists

### Port Already in Use
- Change the PORT in `.env` to another value (e.g., 3001)
- Or stop the process using port 3000

### CORS Issues
- The server includes CORS middleware
- If accessing from a different domain, check CORS configuration in `server.js`

## License

MIT License - Institute of Directors-Ghana
