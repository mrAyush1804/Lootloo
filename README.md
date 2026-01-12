# 🏗️ TaskLoot - Production Architecture & System Design

A production-ready gaming platform where companies create puzzle tasks and users solve them to earn rewards.

## 🌟 Features

- **Microservices Architecture** - Scalable, maintainable service-oriented design
- **JWT Authentication** - Secure token-based authentication with refresh tokens
- **Puzzle Generation** - Dynamic image puzzle creation with AWS S3 integration
- **Payment Processing** - Razorpay integration for featured tasks and payouts
- **Analytics Dashboard** - Comprehensive metrics and reporting
- **Real-time Updates** - WebSocket support for live notifications
- **Rate Limiting** - Advanced rate limiting and security measures
- **Database Migrations** - Version-controlled database schema management

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                             │
│   (Next.js SPA) (React Native Mobile) (Admin Dashboard)     │
└────────────┬────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────┐
│                  API GATEWAY & LOAD BALANCER                │
│              (Nginx / AWS ALB with Rate Limiting)           │
└────────────┬────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────┐
│               BACKEND SERVICES (Node.js/Express)            │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │  Auth    │  Task    │  User    │  Payment │ Analytics │  │
│  │ Service  │ Service  │ Service  │ Service  │ Service  │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
└────────────┬────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────┐
│                   DATA LAYER                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  PostgreSQL  │  │    Redis     │  │  S3 / Cloud  │     │
│  │  (Primary)   │  │    (Cache)   │  │  Storage     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- AWS Account (for S3 storage)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd taskloot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment setup**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Database setup**
   ```bash
   # Run database migrations
   npm run migrate
   
   # Seed initial data
   npm run seed
   ```

5. **Start the server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## 📁 Project Structure

```
src/
├── index.js                 # Main application entry point
├── middleware/              # Express middleware
│   ├── auth.js            # Authentication & authorization
│   └── errorHandler.js    # Error handling middleware
├── services/               # Microservices
│   ├── auth/              # Authentication service
│   ├── tasks/             # Task & puzzle service
│   ├── users/             # User management service
│   ├── payments/          # Payment processing service
│   └── analytics/         # Analytics service
├── database/              # Database layer
│   ├── connection.js      # Database connection
│   ├── schema.sql         # Database schema
│   ├── migrate.js         # Migration manager
│   └── seed.js            # Database seeder
├── cache/                 # Caching layer
│   └── redis.js           # Redis client & cache service
├── utils/                 # Utility functions
│   └── logger.js          # Logging configuration
└── routes/                # Route definitions
    └── health.js          # Health check routes
```

## 🔧 Configuration

### Environment Variables

Key environment variables (see `.env.example` for complete list):

```bash
# Application
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/taskloot

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_PRIVATE_KEY=<RSA_PRIVATE_KEY>
JWT_PUBLIC_KEY=<RSA_PUBLIC_KEY>

# Payment
RAZORPAY_KEY_ID=<RAZORPAY_KEY_ID>
RAZORPAY_KEY_SECRET=<RAZORPAY_KEY_SECRET>

# AWS
AWS_ACCESS_KEY_ID=<AWS_ACCESS_KEY>
AWS_SECRET_ACCESS_KEY=<AWS_SECRET_KEY>
S3_BUCKET=<S3_BUCKET_NAME>
```

## 📚 API Documentation

### Authentication

#### Register User
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "role": "player",
  "name": "John Doe"
}
```

#### Login
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Tasks

#### Create Task (Company)
```http
POST /api/v1/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Pizza Puzzle",
  "description": "Solve this fun puzzle!",
  "task_type": "image-puzzle",
  "difficulty": "easy",
  "reward_type": "discount",
  "reward_value": 20.00,
  "reward_description": "20% off on next order"
}
```

#### List Tasks
```http
GET /api/v1/tasks/list?page=1&limit=20&difficulty=easy
```

### Payments

#### Create Featured Task Payment
```http
POST /api/v1/payments/feature-task
Authorization: Bearer <token>
Content-Type: application/json

{
  "task_id": "uuid",
  "duration_days": 7,
  "payment_method": "card"
}
```

## 🗄️ Database Schema

The application uses PostgreSQL with the following main tables:

- **users** - User accounts and authentication
- **tasks** - Puzzle tasks created by companies
- **task_attempts** - User attempts to solve tasks
- **user_rewards** - Rewards earned by users
- **payments** - Payment transactions
- **company_profiles** - Company information and KYC

See `src/database/schema.sql` for complete schema.

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage
npm run test:coverage
```

## 📊 Analytics & Monitoring

### Health Checks

- **General Health**: `/health`
- **Readiness Probe**: `/health/ready`
- **Liveness Probe**: `/health/live`

### Metrics

The application tracks comprehensive analytics including:

- User engagement metrics
- Task completion rates
- Revenue analytics
- Company performance dashboards

## 🔒 Security Features

- **JWT Authentication** with RS256 signing
- **Rate Limiting** per user and IP
- **Input Validation** with comprehensive sanitization
- **Password Security** with bcrypt hashing
- **CORS Protection** with configurable origins
- **SQL Injection Prevention** with parameterized queries

## 🚀 Deployment

### Docker

```bash
# Build image
npm run build:docker

# Run container
docker run -p 3000:3000 taskloot:latest
```

### Production Deployment

1. **Environment Setup**
   - Configure production environment variables
   - Set up PostgreSQL and Redis clusters
   - Configure AWS S3 bucket

2. **Database Migration**
   ```bash
   npm run migrate
   ```

3. **Start Application**
   ```bash
   npm start
   ```

## 📈 Performance & Scalability

### Caching Strategy

- **L1 Cache**: In-memory cache (seconds)
- **L2 Cache**: Redis cache (minutes)
- **L3 Cache**: Database queries

### Database Optimization

- **Connection Pooling** with configurable pool sizes
- **Query Optimization** with proper indexing
- **Read Replicas** for read-heavy operations

### Auto-scaling

- **Horizontal Pod Autoscaling** based on CPU/memory
- **Load Balancing** with Nginx/AWS ALB
- **Circuit Breaker** pattern for fault tolerance

## 🔄 CI/CD Pipeline

The application includes comprehensive CI/CD setup:

- **Automated Testing** on every push
- **Code Quality Checks** with ESLint
- **Security Scanning** for vulnerabilities
- **Automated Deployment** to staging/production

## 📝 Development Guidelines

### Code Style

- **ESLint** configuration for consistent code style
- **Prettier** for code formatting
- **Conventional Commits** for commit messages

### Best Practices

- **Error Handling** with custom error classes
- **Logging** with structured logs
- **Validation** with comprehensive input validation
- **Security** with defense-in-depth approach

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:

- 📧 Email: support@taskloot.com
- 📖 Documentation: [docs.taskloot.com](https://docs.taskloot.com)
- 🐛 Issues: [GitHub Issues](https://github.com/taskloot/issues)

---

**Built with ❤️ by the TaskLoot Engineering Team**
