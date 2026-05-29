-- ============================================================================
-- ACCOUNTS SEED DATA
-- ============================================================================

INSERT INTO accounts (id, user_id, account_name, type, subtype, institution_name, last_four, plaid_account_id, plaid_item_id, balance_current, balance_available, currency_code, is_active, created_at, updated_at) VALUES
-- John's accounts
(1, 1, 'Chase Freedom Checking', 'depository', 'checking', 'Chase Bank', '1234', 'plaid_acc_001', 'plaid_item_001', 5420.50, 5420.50, 'USD', TRUE, '2024-01-15 10:30:00', '2024-12-22 08:00:00'),
(2, 1, 'Chase Savings', 'depository', 'savings', 'Chase Bank', '5678', 'plaid_acc_002', 'plaid_item_001', 12500.00, 12500.00, 'USD', TRUE, '2024-01-15 10:30:00', '2024-12-22 08:00:00'),
(3, 1, 'Chase Freedom Unlimited', 'credit', 'credit card', 'Chase Bank', '9012', 'plaid_acc_003', 'plaid_item_001', -850.25, 4149.75, 'USD', TRUE, '2024-01-15 10:30:00', '2024-12-22 08:00:00'),

-- Jane's accounts
(4, 2, 'Wells Fargo Checking', 'depository', 'checking', 'Wells Fargo', '3456', 'plaid_acc_004', 'plaid_item_002', 3200.75, 3200.75, 'USD', TRUE, '2024-01-16 12:30:00', '2024-12-22 08:00:00'),
(5, 2, 'Wells Fargo Savings', 'depository', 'savings', 'Wells Fargo', '7890', 'plaid_acc_005', 'plaid_item_002', 18750.00, 18750.00, 'USD', TRUE, '2024-01-16 12:30:00', '2024-12-22 08:00:00'),

-- Mike's accounts
(6, 3, 'Bank of America Checking', 'depository', 'checking', 'Bank of America', '2468', 'plaid_acc_006', 'plaid_item_003', 2890.30, 2890.30, 'USD', TRUE, '2024-01-20 15:00:00', '2024-12-22 08:00:00'),
(7, 3, 'Fidelity Investment Account', 'investment', 'brokerage', 'Fidelity', '1357', 'plaid_acc_007', 'plaid_item_004', 45600.00, 45600.00, 'USD', TRUE, '2024-01-20 15:30:00', '2024-12-22 08:00:00'),

-- Sarah's accounts
(8, 4, 'Capital One Checking', 'depository', 'checking', 'Capital One', '9753', 'plaid_acc_008', 'plaid_item_005', 1560.80, 1560.80, 'USD', TRUE, '2024-02-01 10:00:00', '2024-12-22 08:00:00'),

-- David's accounts
(9, 5, 'Ally Bank Savings', 'depository', 'savings', 'Ally Bank', '8642', 'plaid_acc_009', 'plaid_item_006', 25000.00, 25000.00, 'USD', TRUE, '2024-02-05 17:00:00', '2024-12-22 08:00:00'),

-- Emily's accounts
(10, 6, 'Discover Checking', 'depository', 'checking', 'Discover', '1111', 'plaid_acc_010', 'plaid_item_007', 4200.00, 4200.00, 'USD', TRUE, '2024-02-10 13:30:00', '2024-12-22 08:00:00'),
(11, 6, 'American Express Gold', 'credit', 'credit card', 'American Express', '2222', 'plaid_acc_011', 'plaid_item_008', -1250.00, 3750.00, 'USD', TRUE, '2024-02-10 13:30:00', '2024-12-22 08:00:00'),

-- Alex's accounts
(12, 7, 'US Bank Checking', 'depository', 'checking', 'US Bank', '3333', 'plaid_acc_012', 'plaid_item_009', 3800.50, 3800.50, 'USD', TRUE, '2024-02-15 11:00:00', '2024-12-22 08:00:00'),

-- Lisa's accounts
(13, 8, 'PNC Checking', 'depository', 'checking', 'PNC Bank', '4444', 'plaid_acc_013', 'plaid_item_010', 2150.25, 2150.25, 'USD', TRUE, '2024-03-01 08:30:00', '2024-12-22 08:00:00');

-- Reset sequence
SELECT setval('accounts_id_seq', (SELECT MAX(id) FROM accounts));
