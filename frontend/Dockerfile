# Step 1: Build React static bundle with Node.js
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors and install dependencies
COPY package*.json ./
RUN npm ci

# Copy full source and build distribution
COPY . .
RUN npm run build

# Step 2: Serve static bundle via ultra-fast Nginx web server
FROM nginx:alpine

# Copy custom Nginx routing config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built HTML/JS/CSS assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]