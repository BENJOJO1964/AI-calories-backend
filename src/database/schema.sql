-- AI Calorie Tracker Database Schema
-- 每日熱量精算師數據庫架構

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    gender VARCHAR(10) CHECK (gender IN ('male', 'female', 'other')),
    height INTEGER, -- in cm
    weight DECIMAL(5,2), -- in kg
    activity_level VARCHAR(20) CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
    goal VARCHAR(20) CHECK (goal IN ('lose_weight', 'maintain_weight', 'gain_weight')),
    target_weight DECIMAL(5,2),
    target_calories INTEGER,
    profile_image_url VARCHAR(500),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255),
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Food categories table
CREATE TABLE IF NOT EXISTS food_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    name_tw VARCHAR(100), -- Traditional Chinese name
    description TEXT,
    parent_id INTEGER REFERENCES food_categories(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Foods table (from nutrition databases)
CREATE TABLE IF NOT EXISTS foods (
    id SERIAL PRIMARY KEY,
    fdc_id VARCHAR(50) UNIQUE,
    data_type VARCHAR(50), -- 'branded_food', 'foundation_food', 'sample_food'
    description VARCHAR(500) NOT NULL,
    description_tw VARCHAR(500), -- Traditional Chinese description
    food_category_id INTEGER REFERENCES food_categories(id),
    brand_owner VARCHAR(200),
    brand_name VARCHAR(200),
    gtin_upc VARCHAR(50), -- Barcode
    ingredients TEXT,
    market_country VARCHAR(100),
    publication_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Nutrients table
CREATE TABLE IF NOT EXISTS nutrients (
    id SERIAL PRIMARY KEY,
    nutrient_nbr VARCHAR(20) UNIQUE,
    name VARCHAR(200) NOT NULL,
    name_tw VARCHAR(200), -- Traditional Chinese name
    unit_name VARCHAR(20) NOT NULL,
    rank INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Food nutrients table (nutritional information per food)
CREATE TABLE IF NOT EXISTS food_nutrients (
    id SERIAL PRIMARY KEY,
    food_id INTEGER REFERENCES foods(id) ON DELETE CASCADE,
    nutrient_id INTEGER REFERENCES nutrients(id) ON DELETE CASCADE,
    amount DECIMAL(10,3),
    data_points INTEGER,
    standard_error DECIMAL(10,3),
    min_value DECIMAL(10,3),
    max_value DECIMAL(10,3),
    median_value DECIMAL(10,3),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(food_id, nutrient_id)
);

-- User food logs table
CREATE TABLE IF NOT EXISTS user_food_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    food_id INTEGER REFERENCES foods(id),
    custom_food_name VARCHAR(200), -- For user-created foods
    amount DECIMAL(8,2) NOT NULL, -- Serving amount
    unit VARCHAR(20) NOT NULL, -- Serving unit (g, ml, cup, etc.)
    meal_type VARCHAR(20) CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    log_date DATE NOT NULL,
    log_time TIME,
    calories DECIMAL(8,2),
    protein DECIMAL(8,2),
    carbs DECIMAL(8,2),
    fat DECIMAL(8,2),
    fiber DECIMAL(8,2),
    sugar DECIMAL(8,2),
    sodium DECIMAL(8,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User custom foods table
CREATE TABLE IF NOT EXISTS user_custom_foods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    serving_size DECIMAL(8,2) NOT NULL,
    serving_unit VARCHAR(20) NOT NULL,
    calories_per_serving DECIMAL(8,2),
    protein_per_serving DECIMAL(8,2),
    carbs_per_serving DECIMAL(8,2),
    fat_per_serving DECIMAL(8,2),
    fiber_per_serving DECIMAL(8,2),
    sugar_per_serving DECIMAL(8,2),
    sodium_per_serving DECIMAL(8,2),
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User exercise logs table
CREATE TABLE IF NOT EXISTS user_exercise_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    exercise_name VARCHAR(200) NOT NULL,
    duration INTEGER NOT NULL, -- in minutes
    calories_burned DECIMAL(8,2),
    intensity VARCHAR(20) CHECK (intensity IN ('low', 'moderate', 'high')),
    log_date DATE NOT NULL,
    log_time TIME,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User weight logs table
CREATE TABLE IF NOT EXISTS user_weight_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    weight DECIMAL(5,2) NOT NULL,
    log_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User goals table
CREATE TABLE IF NOT EXISTS user_goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    goal_type VARCHAR(50) NOT NULL, -- 'weight_loss', 'weight_gain', 'maintenance', 'muscle_gain'
    target_value DECIMAL(8,2),
    target_date DATE,
    current_value DECIMAL(8,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI analysis logs table
CREATE TABLE IF NOT EXISTS ai_analysis_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    analysis_type VARCHAR(50) NOT NULL, -- 'food_recognition', 'nutrition_advice', 'meal_planning'
    input_data JSONB, -- Input data for AI analysis
    output_data JSONB, -- AI analysis results
    confidence_score DECIMAL(3,2), -- AI confidence score (0-1)
    processing_time INTEGER, -- Processing time in milliseconds
    model_version VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    language VARCHAR(10) DEFAULT 'zh-TW',
    units VARCHAR(20) DEFAULT 'metric', -- 'metric' or 'imperial'
    calorie_goal INTEGER,
    protein_goal DECIMAL(8,2),
    carb_goal DECIMAL(8,2),
    fat_goal DECIMAL(8,2),
    fiber_goal DECIMAL(8,2),
    sugar_goal DECIMAL(8,2),
    sodium_goal DECIMAL(8,2),
    water_goal INTEGER, -- in ml
    reminders JSONB, -- Reminder settings
    privacy_settings JSONB, -- Privacy preferences
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Food search history table
CREATE TABLE IF NOT EXISTS food_search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    search_query VARCHAR(500) NOT NULL,
    search_results JSONB,
    clicked_food_id INTEGER REFERENCES foods(id),
    search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_foods_description ON foods(description);
CREATE INDEX IF NOT EXISTS idx_foods_fdc_id ON foods(fdc_id);
CREATE INDEX IF NOT EXISTS idx_foods_brand_name ON foods(brand_name);
CREATE INDEX IF NOT EXISTS idx_foods_gtin_upc ON foods(gtin_upc);
CREATE INDEX IF NOT EXISTS idx_food_nutrients_food_id ON food_nutrients(food_id);
CREATE INDEX IF NOT EXISTS idx_food_nutrients_nutrient_id ON food_nutrients(nutrient_id);
CREATE INDEX IF NOT EXISTS idx_user_food_logs_user_id ON user_food_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_food_logs_log_date ON user_food_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_user_food_logs_meal_type ON user_food_logs(meal_type);
CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_user_id ON user_exercise_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_log_date ON user_exercise_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_user_weight_logs_user_id ON user_weight_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_weight_logs_log_date ON user_weight_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_user_id ON ai_analysis_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_analysis_type ON ai_analysis_logs(analysis_type);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_food_logs_updated_at BEFORE UPDATE ON user_food_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_custom_foods_updated_at BEFORE UPDATE ON user_custom_foods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_goals_updated_at BEFORE UPDATE ON user_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
