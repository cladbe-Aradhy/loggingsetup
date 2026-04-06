# MVC Manual Integration Service

Simple TypeScript Express MVC service with no observability package integration.

Purpose:
- give you a clean service base
- let you add the observability package yourself
- make integration points easy to understand

## Structure

- `src/server.ts`
  App bootstrap and HTTP server start
- `src/app.ts`
  Express app setup, core routes, and middleware registration
- `src/routes/`
  Route definitions
- `src/controllers/`
  Request handlers
- `src/services/`
  Business logic
- `src/models/`
  Types and domain errors
- `src/middlewares/`
  Not-found and error handlers
- `src/config/`
  Environment config

## Routes

- `GET /health`
- `GET /coverage`
- `GET /users`
- `GET /users/:id`
- `POST /users`
- `GET /orders`
- `GET /orders/:id`
- `POST /orders`
- `PATCH /orders/:id/pay`

## Run

```bash
cd /Users/cladbe/Desktop/loggingPackage/mvc-manual-integration-service
npm install
npm run build
npm start
```

Default port: `3080`

## Good Future Integration Points

When you integrate the observability package manually later, these are the most natural places:

1. `src/server.ts`
   App startup bootstrap
2. `src/app.ts`
   Express middleware setup
3. `src/middlewares/error-handler.ts`
   Error capture path
4. `src/controllers/`
   Manual spans/logs for important business flows
5. `src/services/`
   Custom counters, histograms, and domain logs
