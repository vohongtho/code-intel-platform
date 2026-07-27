#!/bin/bash
set -e

# =============================================================================
# Production Smoke Tests for SPA Routing Fix
# =============================================================================
# 
# This script verifies that the SPA routing fix is working correctly after
# deployment. It tests:
# 1. All SPA routes return HTML (not 404)
# 2. API routes still return JSON (not affected by SPA catch-all)
# 3. Admin routes still return JSON
#
# Usage:
#   ./scripts/smoke-test.sh [SERVER_URL]
#
# Examples:
#   ./scripts/smoke-test.sh http://localhost:4747
#   ./scripts/smoke-test.sh https://code-intel.example.com
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed
#
# Context:
#   This verifies the SPA fallback remains correctly ordered after API/admin
#   routes and that the runtime-valid Express 5 catch-all continues serving
#   routed pages as HTML.
# =============================================================================

SERVER_URL="${1:-http://localhost:4747}"

echo "======================================================================"
echo "SPA Routing Smoke Tests"
echo "======================================================================"
echo "Target: $SERVER_URL"
echo "Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

FAILED=0
PASSED=0

# Test helper function
test_route() {
  local route="$1"
  local expected_content_type="$2"
  local expected_status="${3:-200}"
  local route_type="$4"
  
  echo -n "Testing $route_type: $route ... "
  
  # Make request and capture status code and content-type
  response=$(curl -s -w "\n%{http_code}\n%{content_type}" "$SERVER_URL$route")
  body=$(echo "$response" | head -n -2)
  status_code=$(echo "$response" | tail -n 2 | head -n 1)
  content_type=$(echo "$response" | tail -n 1)
  
  # Check status code
  if [[ "$status_code" != "$expected_status" ]]; then
    echo "❌ FAIL (Expected status $expected_status, got $status_code)"
    FAILED=$((FAILED + 1))
    return 1
  fi
  
  # Check content type
  if [[ ! "$content_type" =~ $expected_content_type ]]; then
    echo "❌ FAIL (Expected $expected_content_type, got $content_type)"
    FAILED=$((FAILED + 1))
    return 1
  fi
  
  # Additional checks based on expected content type
  if [[ "$expected_content_type" == "text/html" ]]; then
    # Verify it's actually HTML
    if [[ ! "$body" =~ \<html ]]; then
      echo "❌ FAIL (Response doesn't contain <html> tag)"
      FAILED=$((FAILED + 1))
      return 1
    fi
    if [[ ! "$body" =~ id=\"root\" ]]; then
      echo "❌ FAIL (Response doesn't contain React root div)"
      FAILED=$((FAILED + 1))
      return 1
    fi
  elif [[ "$expected_content_type" == "application/json" ]]; then
    # Verify it's valid JSON and not HTML
    if [[ "$body" =~ \<html ]]; then
      echo "❌ FAIL (JSON endpoint returned HTML!)"
      FAILED=$((FAILED + 1))
      return 1
    fi
    if ! echo "$body" | jq -e . >/dev/null 2>&1; then
      echo "❌ FAIL (Response is not valid JSON)"
      FAILED=$((FAILED + 1))
      return 1
    fi
  fi
  
  echo "✓ OK"
  PASSED=$((PASSED + 1))
  return 0
}

echo "----------------------------------------------------------------------"
echo "Phase 1: SPA Routes (should return HTML)"
echo "----------------------------------------------------------------------"

test_route "/login" "text/html" "200" "SPA"
test_route "/connect" "text/html" "200" "SPA"
test_route "/loading" "text/html" "200" "SPA"
test_route "/explore" "text/html" "200" "SPA" # User-reported issue
test_route "/settings" "text/html" "200" "SPA"
test_route "/settings/profile" "text/html" "200" "SPA"
test_route "/settings/appearance" "text/html" "200" "SPA"

echo ""
echo "----------------------------------------------------------------------"
echo "Phase 2: API Routes (should return JSON)"
echo "----------------------------------------------------------------------"

echo -n "Testing API: /api/v1/health ... "
response=$(curl -s -w "\n%{http_code}\n%{content_type}" "$SERVER_URL/api/v1/health")
body=$(echo "$response" | head -n -2)
status_code=$(echo "$response" | tail -n 2 | head -n 1)
content_type=$(echo "$response" | tail -n 1)
if [[ "$status_code" == "200" ]] || [[ "$status_code" == "401" ]]; then
  if [[ "$content_type" =~ application/json ]] && [[ ! "$body" =~ \<html ]]; then
    echo "✓ OK (status $status_code, JSON not HTML)"
    PASSED=$((PASSED + 1))
  else
    echo "❌ FAIL (Expected JSON non-HTML, got $content_type)"
    FAILED=$((FAILED + 1))
  fi
else
  echo "❌ FAIL (Expected 200 or 401, got $status_code)"
  FAILED=$((FAILED + 1))
fi

# Repos endpoint may be 401 if auth is required
echo -n "Testing API: /api/v1/repos ... "
response=$(curl -s -w "\n%{http_code}\n%{content_type}" "$SERVER_URL/api/v1/repos")
body=$(echo "$response" | head -n -2)
status_code=$(echo "$response" | tail -n 2 | head -n 1)
content_type=$(echo "$response" | tail -n 1)

if [[ "$status_code" == "200" ]] || [[ "$status_code" == "401" ]]; then
  if [[ "$content_type" =~ application/json ]] && [[ ! "$body" =~ \<html ]]; then
    echo "✓ OK (status $status_code, JSON not HTML)"
    PASSED=$((PASSED + 1))
  else
    echo "❌ FAIL (Expected JSON non-HTML, got $content_type)"
    FAILED=$((FAILED + 1))
  fi
else
  echo "❌ FAIL (Expected 200 or 401, got $status_code)"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "----------------------------------------------------------------------"
echo "Phase 3: Admin Routes (should return JSON)"
echo "----------------------------------------------------------------------"

# Admin endpoints will be 401 or 403 without proper auth
echo -n "Testing Admin: /admin/users ... "
response=$(curl -s -w "\n%{http_code}\n%{content_type}" "$SERVER_URL/admin/users")
body=$(echo "$response" | head -n -2)
status_code=$(echo "$response" | tail -n 2 | head -n 1)
content_type=$(echo "$response" | tail -n 1)

# Accept 200, 401, or 403 - just verify it's JSON not HTML
if [[ "$content_type" =~ application/json ]]; then
  if [[ ! "$body" =~ \<html ]]; then
    echo "✓ OK (status $status_code, JSON not HTML)"
    PASSED=$((PASSED + 1))
  else
    echo "❌ FAIL (Admin route returned HTML instead of JSON!)"
    FAILED=$((FAILED + 1))
  fi
else
  echo "❌ FAIL (Expected JSON, got $content_type)"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "----------------------------------------------------------------------"
echo "Phase 4: Error Handling"
echo "----------------------------------------------------------------------"

# Non-existent unauthenticated API route should return JSON error
# Auth-first middleware may return 401 before route-not-found handling.
echo -n "Testing API Error: /api/v1/nonexistent ... "
response=$(curl -s -w "\n%{http_code}\n%{content_type}" "$SERVER_URL/api/v1/nonexistent")
body=$(echo "$response" | head -n -2)
status_code=$(echo "$response" | tail -n 2 | head -n 1)
content_type=$(echo "$response" | tail -n 1)
if [[ "$status_code" == "401" ]] || [[ "$status_code" == "404" ]]; then
  if [[ "$content_type" =~ application/json ]] && [[ ! "$body" =~ \<html ]]; then
    echo "✓ OK (status $status_code, JSON not HTML)"
    PASSED=$((PASSED + 1))
  else
    echo "❌ FAIL (Expected JSON non-HTML, got $content_type)"
    FAILED=$((FAILED + 1))
  fi
else
  echo "❌ FAIL (Expected 401 or 404, got $status_code)"
  FAILED=$((FAILED + 1))
fi

# Non-existent SPA route should return HTML (caught by SPA fallback)
test_route "/some/random/path" "text/html" "200" "SPA Catchall"

echo ""
echo "======================================================================"
echo "Results"
echo "======================================================================"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "✅ All smoke tests passed!"
  echo ""
  echo "The SPA routing fix is working correctly:"
  echo "  ✓ Direct access to SPA routes works"
  echo "  ✓ Browser reload will work on SPA routes"
  echo "  ✓ Deep links can be shared"
  echo "  ✓ API routes are unaffected"
  echo "  ✓ Admin routes are unaffected"
  exit 0
else
  echo "❌ Some smoke tests failed!"
  echo ""
  echo "The SPA routing fix may not be working correctly."
  echo "Please review the failed tests above and check:"
  echo "  1. Web UI is built and deployed"
  echo "  2. Express app.ts has correct catch-all syntax and position"
  echo "  3. Server has been restarted with new code"
  exit 1
fi
