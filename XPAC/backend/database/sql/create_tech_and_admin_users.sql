-- ============================================================================
--  Seed accounts: 20 technicians (tech01-tech20) and 2 administrators
--  (admin01-admin02). Every account's password is: xpac1234
--
--  Run against the XPAC database (phpMyAdmin / MySQL client). Safe to re-run:
--  an account whose username or email already exists is skipped, never
--  overwritten.
--
--  Roles are looked up by name ('Technician', 'Administrator') rather than by
--  id, so the script works whatever ids those roles have in this database. If a
--  role does not exist, its accounts are not created.
--
--  The hash below is bcrypt (cost 12) of 'xpac1234', which is what the login
--  route checks with Hash::check().
-- ============================================================================

INSERT INTO users
    (username, password_hash, email_address, first_name, last_name,
     role_id, status, darkmode, active, created_at, updated_at)
SELECT a.username, '$2y$12$/r6YLzSxitSERN8E9TAVJ.lwQU53iXfexaki2EmzTi5Kr4utN2cz6', a.email, a.first_name, a.last_name,
       r.id, 'active', 'light', 1, NOW(), NOW()
FROM (
    SELECT 'tech01' AS username, 'tech01@gmail.com' AS email, 'Technician' AS first_name, '01' AS last_name, 'Technician' AS role_name
    UNION ALL SELECT 'tech02', 'tech02@gmail.com', 'Technician', '02', 'Technician'
    UNION ALL SELECT 'tech03', 'tech03@gmail.com', 'Technician', '03', 'Technician'
    UNION ALL SELECT 'tech04', 'tech04@gmail.com', 'Technician', '04', 'Technician'
    UNION ALL SELECT 'tech05', 'tech05@gmail.com', 'Technician', '05', 'Technician'
    UNION ALL SELECT 'tech06', 'tech06@gmail.com', 'Technician', '06', 'Technician'
    UNION ALL SELECT 'tech07', 'tech07@gmail.com', 'Technician', '07', 'Technician'
    UNION ALL SELECT 'tech08', 'tech08@gmail.com', 'Technician', '08', 'Technician'
    UNION ALL SELECT 'tech09', 'tech09@gmail.com', 'Technician', '09', 'Technician'
    UNION ALL SELECT 'tech10', 'tech10@gmail.com', 'Technician', '10', 'Technician'
    UNION ALL SELECT 'tech11', 'tech11@gmail.com', 'Technician', '11', 'Technician'
    UNION ALL SELECT 'tech12', 'tech12@gmail.com', 'Technician', '12', 'Technician'
    UNION ALL SELECT 'tech13', 'tech13@gmail.com', 'Technician', '13', 'Technician'
    UNION ALL SELECT 'tech14', 'tech14@gmail.com', 'Technician', '14', 'Technician'
    UNION ALL SELECT 'tech15', 'tech15@gmail.com', 'Technician', '15', 'Technician'
    UNION ALL SELECT 'tech16', 'tech16@gmail.com', 'Technician', '16', 'Technician'
    UNION ALL SELECT 'tech17', 'tech17@gmail.com', 'Technician', '17', 'Technician'
    UNION ALL SELECT 'tech18', 'tech18@gmail.com', 'Technician', '18', 'Technician'
    UNION ALL SELECT 'tech19', 'tech19@gmail.com', 'Technician', '19', 'Technician'
    UNION ALL SELECT 'tech20', 'tech20@gmail.com', 'Technician', '20', 'Technician'
    UNION ALL SELECT 'admin01', 'admin01@gmail.com', 'Admin', '01', 'Administrator'
    UNION ALL SELECT 'admin02', 'admin02@gmail.com', 'Admin', '02', 'Administrator'
) AS a
JOIN roles r ON r.role_name = a.role_name
WHERE NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.username = a.username OR u.email_address = a.email
);

-- Check the result: should list 22 rows.
SELECT u.id, u.username, u.email_address, r.role_name, u.status, u.active
FROM users u
LEFT JOIN roles r ON r.id = u.role_id
WHERE u.username REGEXP '^(tech(0[1-9]|1[0-9]|20)|admin0[12])$'
ORDER BY r.role_name, u.username;
