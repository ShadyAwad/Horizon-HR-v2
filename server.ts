import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // === HORIZON HR API ROUTES ===

  // Registration Route for multi-tenant wizard
  app.post('/api/auth/register-tenant', async (req, res) => {
    // In production:
    // 1. BEGIN TRANSACTION
    // 2. INSERT INTO tenants (company_name, slug, default_currency, capacity_tier, allows_company_loans) 
    //      VALUES (req.body.companyName, req.body.tenantSlug, ...) RETURNING id;
    // 3. INSERT INTO employees (tenant_id, email, password_hash, role)
    //      VALUES (tenant.id, req.body.adminEmail, hash(req.body.adminPassword), 'hr_admin');
    // 4. INSERT INTO geofences (tenant_id, name, boundary)
    //      VALUES (tenant.id, 'HQ', ST_Buffer(ST_MakePoint(req.body.lng, req.body.lat)::geography, req.body.radius)::geometry);
    // 5. COMMIT
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate work

    // For demo: pretend it worked always, unless slug is exactly 'taken'
    if (req.body.tenantSlug === 'taken') {
      res.status(400).json({ success: false, error: 'Tenant slug is already taken.' });
    } else {
      res.json({ success: true, message: 'Tenant sandbox initialized successfully.' });
    }
  });

  // 1. Auth Endpoint (Simulates secure iron-session check)
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Simulate database lookup latency for biometric UI experience
    await new Promise(resolve => setTimeout(resolve, 800));

    if (email === 'admin@horizon.com' && password === 'admin') {
      res.json({
        success: true,
        user: { 
          id: 'u-1', 
          name: 'Sarah Connor', 
          role: 'HR Admin', 
          tenant: 'Cyberdyne Systems'
        }
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Invalid biometric pattern or credentials'
      });
    }
  });

  // 2. Geofenced Clock-In Simulator
  // In production, this would execute PostGIS: 
  // ST_DWithin(employee_location, geofence.boundary, radius)
  app.post('/api/clock-in', (req, res) => {
    const { latitude, longitude } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Geolocation required for clock-in' });
    }

    // Mock HQ Location: 37.7749, -122.4194 (San Francisco)
    // Accept anything within a loose bounding box for the demo
    const hqLat = 37.7749;
    const hqLng = -122.4194;
    
    // Math.abs diff logic purely to mock PostGIS in this runtime
    const isWithinGeofence = Math.abs(latitude - hqLat) < 0.5 && Math.abs(longitude - hqLng) < 0.5;

    res.json({
      success: true,
      clockedIn: new Date().toISOString(),
      locationValid: isWithinGeofence,
      message: isWithinGeofence ? 'Clock-in secured.' : 'Warning: Clock-in recorded outside geofenced perimeter.'
    });
  });

  // === VITE DEV/PRODUCTION MIDDLEWARE ===
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Horizon HR Network] Edge Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
