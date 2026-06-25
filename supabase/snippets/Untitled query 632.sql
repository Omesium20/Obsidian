SELECT count(*), state FROM pg_stat_activity GROUP BY state;   -- live connections    
SELECT pg_size_pretty(pg_database_size(current_database()));    -- DB size