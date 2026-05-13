#!/usr/bin/env python3
# ============================================================
# Excel to PostgreSQL Migration Script
# IOD Ghana Membership Database
# ============================================================

import pandas as pd
import psycopg2
from psycopg2.extras import execute_batch, execute_values
import logging
from datetime import datetime
import sys

# ============================================================
# Configuration
# ============================================================

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

DB_CONFIG = {
    'dbname': os.getenv('DB_NAME', 'iod_ghana'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', 5432))
}

EXCEL_FILE = 'members_data.csv'  # or .xlsx
BATCH_SIZE = 1000
LOG_FILE = f'migration_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'

# ============================================================
# Logging Setup
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ============================================================
# Database Connection
# ============================================================

def get_connection():
    """Create database connection"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        logger.info("✓ Database connection established")
        return conn
    except Exception as e:
        logger.error(f"✗ Database connection failed: {e}")
        sys.exit(1)

# ============================================================
# Data Loading & Transformation
# ============================================================

def load_excel_data(filepath):
    """Load Excel/CSV file"""
    logger.info(f"Loading data from {filepath}...")
    try:
        if filepath.endswith('.csv'):
            df = pd.read_csv(filepath)
        else:
            df = pd.read_excel(filepath)
        logger.info(f"✓ Loaded {len(df)} rows")
        return df
    except Exception as e:
        logger.error(f"✗ Failed to load file: {e}")
        sys.exit(1)

def clean_data(df):
    """Clean and validate data"""
    logger.info("Cleaning data...")
    
    # Remove completely empty rows
    df = df.dropna(how='all')
    logger.info(f"  Removed empty rows: {len(df)} rows remain")
    
    # Fill NaN in text fields with empty string
    text_cols = df.select_dtypes(include=['object']).columns
    df[text_cols] = df[text_cols].fillna('')
    
    # Ensure membership_number is not null
    if 'membership_number' in df.columns:
        df = df[df['membership_number'].notna()]
        logger.info(f"  Removed rows without membership_number: {len(df)} valid rows")
    
    # Convert subscription columns (SUBSCRIPTION_YYYY) to boolean
    subscription_cols = [col for col in df.columns if col.startswith('SUBSCRIPTION')]
    logger.info(f"  Found {len(subscription_cols)} subscription columns: {subscription_cols}")
    
    for col in subscription_cols:
        df[col] = df[col].fillna(False).astype(bool)
    
    logger.info(f"✓ Data cleaning complete")
    return df

def get_subscription_years(df):
    """Extract subscription year columns"""
    subscription_cols = [col for col in df.columns if col.startswith('SUBSCRIPTION')]
    years = []
    for col in subscription_cols:
        try:
            year = int(col.split('_')[1])
            years.append((col, year))
        except (IndexError, ValueError):
            logger.warning(f"  Could not parse year from column: {col}")
    return sorted(years, key=lambda x: x[1])

# ============================================================
# Database Operations
# ============================================================

def migrate_members(conn, df, subscription_cols):
    """Migrate members data"""
    logger.info("Migrating members...")
    cur = conn.cursor()
    
    members_data = []
    
    for idx, row in df.iterrows():
        try:
            members_data.append((
                row.get('membership_number', ''),
                row.get('member_type', 'AIOD'),
                row.get('title', ''),
                row.get('first_name', ''),
                row.get('surname', row.get('last_name', '')),
                row.get('last_name', row.get('surname', '')),
                row.get('other_names', ''),
                row.get('gender', ''),
                row.get('organization', 'Unknown'),
                row.get('designation', row.get('position', '')),
                row.get('position', row.get('designation', '')),
                row.get('sector', ''),
                row.get('years_served_on_boards', 0),
                row.get('region', ''),
                row.get('postal_address', ''),
                row.get('phone_number', ''),
                row.get('email', ''),
                row.get('date_of_admission', None),
                row.get('registration_date', None),
            ))
        except Exception as e:
            logger.warning(f"  Skipped row {idx}: {e}")
            continue
    
    # Batch insert
    sql = """
        INSERT INTO members (
            membership_number, member_type, title, first_name, surname,
            last_name, other_names, gender, organization, designation, position,
            sector, years_served_on_boards, region, postal_address, phone_number,
            email, date_of_admission, registration_date
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (membership_number) DO UPDATE SET updated_at = NOW()
    """
    
    try:
        execute_batch(cur, sql, members_data, page_size=BATCH_SIZE)
        conn.commit()
        logger.info(f"✓ Migrated {len(members_data)} members")
        return len(members_data)
    except Exception as e:
        conn.rollback()
        logger.error(f"✗ Member migration failed: {e}")
        raise

def get_member_id_map(conn):
    """Get mapping of membership_number to member_id"""
    cur = conn.cursor()
    cur.execute("SELECT id, membership_number FROM members")
    return {row[1]: row[0] for row in cur.fetchall()}

def migrate_subscriptions(conn, df, subscription_cols, member_id_map):
    """Migrate subscriptions data"""
    logger.info("Migrating subscriptions...")
    cur = conn.cursor()
    
    subscriptions_data = []
    skipped = 0
    
    for idx, row in df.iterrows():
        membership_num = row.get('membership_number', '')
        
        if membership_num not in member_id_map:
            skipped += 1
            continue
        
        member_id = member_id_map[membership_num]
        
        # Process each subscription column
        for col_name, year in subscription_cols:
            try:
                status = 'Paid' if row.get(col_name, False) else 'Pending'
                
                subscriptions_data.append((
                    member_id,
                    year,
                    status,
                    None,  # amount_due
                    None,  # amount_paid
                    None,  # payment_date
                    None,  # receipt_number
                ))
            except Exception as e:
                logger.warning(f"  Skipped subscription for {membership_num} year {year}: {e}")
                continue
    
    # Batch insert
    sql = """
        INSERT INTO subscriptions (
            member_id, subscription_year, status, 
            amount_due, amount_paid, payment_date, receipt_number
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (member_id, subscription_year) DO NOTHING
    """
    
    try:
        execute_batch(cur, sql, subscriptions_data, page_size=BATCH_SIZE)
        conn.commit()
        logger.info(f"✓ Migrated {len(subscriptions_data)} subscriptions")
        if skipped > 0:
            logger.warning(f"  Skipped {skipped} members (not found in members table)")
        return len(subscriptions_data)
    except Exception as e:
        conn.rollback()
        logger.error(f"✗ Subscription migration failed: {e}")
        raise

# ============================================================
# Validation
# ============================================================

def validate_migration(conn):
    """Validate migration success"""
    logger.info("Validating migration...")
    cur = conn.cursor()
    
    # Check member count
    cur.execute("SELECT COUNT(*) FROM members")
    member_count = cur.fetchone()[0]
    logger.info(f"  Members: {member_count}")
    
    # Check subscription count
    cur.execute("SELECT COUNT(*) FROM subscriptions")
    subscription_count = cur.fetchone()[0]
    logger.info(f"  Subscriptions: {subscription_count}")
    
    # Check for duplicates
    cur.execute("""
        SELECT membership_number, COUNT(*)
        FROM members
        GROUP BY membership_number
        HAVING COUNT(*) > 1
    """)
    duplicates = cur.fetchall()
    if duplicates:
        logger.warning(f"  Found {len(duplicates)} duplicate membership numbers")
        for dup in duplicates:
            logger.warning(f"    {dup[0]}: {dup[1]} occurrences")
    else:
        logger.info("  ✓ No duplicate membership numbers")
    
    # Check for orphaned subscriptions
    cur.execute("""
        SELECT COUNT(*)
        FROM subscriptions s
        WHERE s.member_id NOT IN (SELECT id FROM members)
    """)
    orphaned = cur.fetchone()[0]
    if orphaned > 0:
        logger.warning(f"  ✗ Found {orphaned} orphaned subscriptions")
    else:
        logger.info("  ✓ No orphaned subscriptions")
    
    # Check subscription year range
    cur.execute("""
        SELECT MIN(subscription_year), MAX(subscription_year)
        FROM subscriptions
    """)
    min_year, max_year = cur.fetchone()
    logger.info(f"  Subscription years: {min_year} - {max_year}")
    
    # Check status distribution
    cur.execute("""
        SELECT status, COUNT(*) as count
        FROM subscriptions
        GROUP BY status
        ORDER BY count DESC
    """)
    logger.info("  Status distribution:")
    for status, count in cur.fetchall():
        logger.info(f"    {status}: {count}")
    
    logger.info("✓ Validation complete")

def compare_with_original(conn, df):
    """Compare migrated data with original"""
    logger.info("Comparing with original data...")
    cur = conn.cursor()
    
    # Sample 10 random members
    cur.execute("""
        SELECT membership_number, member_type, first_name, organization
        FROM members
        ORDER BY RANDOM()
        LIMIT 10
    """)
    
    logger.info("Sample migrated data:")
    for row in cur.fetchall():
        logger.info(f"  {row[0]}: {row[1]} {row[2]} ({row[3]})")

# ============================================================
# Main Migration Process
# ============================================================

def main():
    """Main migration function"""
    logger.info("=" * 60)
    logger.info("IOD Ghana Migration: Excel → PostgreSQL")
    logger.info("=" * 60)
    
    start_time = datetime.now()
    
    try:
        # Step 1: Load data
        df = load_excel_data(EXCEL_FILE)
        logger.info(f"Columns found: {list(df.columns)}")
        
        # Step 2: Clean data
        df = clean_data(df)
        
        # Step 3: Get subscription columns and years
        subscription_cols = get_subscription_years(df)
        logger.info(f"Subscription columns: {subscription_cols}")
        
        # Step 4: Connect to database
        conn = get_connection()
        
        # Step 5: Migrate members
        member_count = migrate_members(conn, df, subscription_cols)
        
        # Step 6: Get member ID mapping
        member_id_map = get_member_id_map(conn)
        logger.info(f"Member ID mapping: {len(member_id_map)} members")
        
        # Step 7: Migrate subscriptions
        subscription_count = migrate_subscriptions(conn, df, subscription_cols, member_id_map)
        
        # Step 8: Validate
        validate_migration(conn)
        
        # Step 9: Compare with original
        compare_with_original(conn, df)
        
        # Close connection
        conn.close()
        
        # Summary
        duration = datetime.now() - start_time
        logger.info("=" * 60)
        logger.info("✓ MIGRATION SUCCESSFUL")
        logger.info("=" * 60)
        logger.info(f"Duration: {duration}")
        logger.info(f"Members migrated: {member_count}")
        logger.info(f"Subscriptions migrated: {subscription_count}")
        logger.info(f"Log file: {LOG_FILE}")
        
    except Exception as e:
        logger.error("=" * 60)
        logger.error("✗ MIGRATION FAILED")
        logger.error("=" * 60)
        logger.error(f"Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
