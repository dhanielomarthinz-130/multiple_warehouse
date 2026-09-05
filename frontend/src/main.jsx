import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import './style.css';

const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    const raw = import.meta.env.VITE_API_URL.trim();
    return raw.endsWith('/api') ? raw : `${raw}/api`;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return '/api';
  }
  return 'http://localhost:4000/api';
};

const API = getApiBaseUrl();

let toastListener = null;

export function showToast(message, type = 'success') {
  if (toastListener) {
    toastListener(message, type);
  } else {
    console.log(`[Toast ${type}]:`, message);
  }
}

if (typeof window !== 'undefined') {
  window.alert = (msg) => {
    showToast(String(msg), 'info');
  };
}

function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast-item toast-${t.type}`}>
          <div className="toast-icon-wrapper">
            <div className={`toast-avatar toast-avatar-${t.type}`}>
              <span className="material-symbols-outlined avatar-main-icon">person</span>
              <span className="material-symbols-outlined avatar-badge-icon">
                {t.type === 'success' ? 'thumb_up' : (t.type === 'error' ? 'close' : 'info')}
              </span>
            </div>
          </div>
          <div className="toast-content">
            <div className="toast-title">
              {t.type === 'success' ? 'Berhasil 🎉' : (t.type === 'error' ? 'Gagal / Perhatian ❌' : 'Informasi')}
            </div>
            <div className="toast-message">{t.message}</div>
          </div>
          <button className="toast-close-btn" onClick={() => removeToast(t.id)}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ))}
    </div>
  );
}

async function apiCall(path, options = {}) {
  const token = localStorage.getItem('token');
  let res;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    res = await fetch(API + path, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.headers || {})
      }
    });
  } catch (netErr) {
    if (netErr.name === 'AbortError') {
      throw new Error('Permintaan ke server memakan waktu terlalu lama (Timeout). Silakan muat ulang halaman.');
    }
    throw new Error('Gagal terhubung ke server. Periksa koneksi internet Anda.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    if (res.status === 404 && (API === '/api' || API.startsWith('/api'))) {
      throw new Error('Server backend belum terhubung. Harap atur VITE_API_URL di Vercel Settings.');
    }
    throw new Error(errData.message || `Respon server error (${res.status}). Silakan coba lagi.`);
  }

  return res.json();
}

function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('jakarta@stockflow.local');
  const [password, setPassword] = useState('admin123');
  const [role, setRole] = useState('WAREHOUSE_ADMIN');
  const [warehouseId, setWarehouseId] = useState('1');
  const [warehouses, setWarehouses] = useState([]);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const demoAccounts = [
    { label: 'Admin Gudang A (Jakarta DC)', email: 'jakarta@stockflow.local', role: 'WAREHOUSE_ADMIN' },
    { label: 'Admin Gudang B (Bekasi Hub)', email: 'bekasi@stockflow.local', role: 'WAREHOUSE_ADMIN' },
    { label: 'Admin Gudang C (Makassar Hub)', email: 'makassar@stockflow.local', role: 'WAREHOUSE_ADMIN' },
    { label: 'Manager Gudang A (Jakarta DC)', email: 'manager@stockflow.local', role: 'MANAGER' },
    { label: 'Manager Gudang B (Bekasi Hub)', email: 'manager_bekasi@stockflow.local', role: 'MANAGER' },
    { label: 'Manager Gudang C (Makassar Hub)', email: 'manager_makassar@stockflow.local', role: 'MANAGER' },
    { label: 'Super Admin (Global HQ)', email: 'admin@stockflow.local', role: 'SUPER_ADMIN' }
  ];

  const roleOptions = [
    { value: 'WAREHOUSE_ADMIN', label: 'Admin Gudang (Warehouse Admin)', desc: 'Mengelola persediaan, dokumen mutasi, surat jalan & transfer cabang.' },
    { value: 'OPERATOR', label: 'Operator Gudang (Staff Lapangan)', desc: 'Pencatatan mutasi fisik, scan barang & pembuatan draft dokumen.' },
    { value: 'MANAGER', label: 'Manager Gudang (Supervisor)', desc: 'Otorisasi persetujuan dokumen PO, approval stok opname & analitik gudang.' },
    { value: 'SUPER_ADMIN', label: 'Super Admin (Global HQ)', desc: 'Akses penuh seluruh cabang gudang, manajemen master data & otorisasi pengguna.' },
    { value: 'VIEWER', label: 'Viewer / Auditor (Read-Only)', desc: 'Melihat dashboard, analitik DOI dan laporan tanpa izin modifikasi data.' }
  ];

  useEffect(() => {
    let active = true;
    apiCall('/auth/warehouses')
      .then(res => {
        if (active && Array.isArray(res) && res.length > 0) {
          setWarehouses(res);
          setWarehouseId(String(res[0].id));
        }
      })
      .catch(err => {
        console.warn('Could not load public warehouses:', err);
        if (active) {
          setWarehouses([
            { id: 1, name: 'Jakarta DC', city: 'Jakarta' },
            { id: 2, name: 'Bekasi Hub', city: 'Bekasi' },
            { id: 3, name: 'Makassar Hub', city: 'Makassar' }
          ]);
        }
      });
    return () => { active = false; };
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      if (isRegister) {
        if (!name.trim()) {
          setError('Nama lengkap wajib diisi.');
          setLoading(false);
          return;
        }
        if (!email.trim()) {
          setError('Email wajib diisi.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Kata sandi minimal 6 karakter.');
          setLoading(false);
          return;
        }

        const payload = {
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          warehouse_id: role === 'SUPER_ADMIN' && warehouseId === 'all' ? null : Number(warehouseId)
        };

        const data = await apiCall('/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        setIsRegister(false);
        setEmail(payload.email);
        setPassword('');
        setSuccessMsg(data.message || 'Pendaftaran berhasil! Silakan masuk dengan kata sandi Anda.');
        setError('');
      } else {
        const data = await apiCall('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        localStorage.setItem('token', data.token);
        localStorage.setItem('stockflow_user', JSON.stringify(data.user));
        onLogin(data.user);
      }
    } catch (err) {
      setError(err.message || 'Gagal terhubung. Periksa kembali input Anda.');
    } finally {
      setLoading(false);
    }
  }

  function handleSelectAccountChange(e) {
    const val = e.target.value;
    if (val) {
      setEmail(val);
      setPassword('admin123');
    }
  }

  return (
    <div className="erp-login-page">
      {/* Top Header Bar */}
      <header className="erp-login-header">
        <div className="erp-brand-logo">
          <div className="logo-icon-box">
            <span className="material-symbols-outlined">inventory_2</span>
          </div>
          <div className="logo-text">
            <span className="brand-name">STOCKFLOW <strong>PRO</strong></span>
            <span className="brand-sub">Enterprise Multi-Warehouse ERP</span>
          </div>
        </div>

        <div className="header-meta">
          <span className="env-badge"><span className="pulse-dot"></span> System Status: Online</span>
          <span className="version-label">v2.4 Enterprise</span>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="erp-login-body">
        {/* Left Side: Enterprise System Overview */}
        <div className="erp-hero-panel">
          <h1 className="hero-title">Multi-Warehouse Operations & Authorization Portal</h1>
          <p className="hero-desc">
            Sistem manajemen persediaan terintegrasi dengan kontrol otorisasi bertingkat, pemantauan stok real-time antar gudang, serta analitik Days of Inventory (DOI).
          </p>

          <div className="hero-feature-cards">
            <div className="hero-card-item">
              <div className="item-icon">
                <span className="material-symbols-outlined">verified_user</span>
              </div>
              <div className="item-body">
                <h3>Otorisasi Tiered Manager Approval</h3>
                <p>Verifikasi & persetujuan dokumen Purchase Order (PO) serta Inbound/Outbound oleh Manager gudang.</p>
              </div>
            </div>

            <div className="hero-card-item">
              <div className="item-icon">
                <span className="material-symbols-outlined">hub</span>
              </div>
              <div className="item-body">
                <h3>Isolasi Data Antar Gudang</h3>
                <p>Proteksi data ketat antar cabang Jakarta DC, Bekasi Hub, dan Makassar Hub.</p>
              </div>
            </div>

            <div className="hero-card-item">
              <div className="item-icon">
                <span className="material-symbols-outlined">analytics</span>
              </div>
              <div className="item-body">
                <h3>Analitik Pergantian Stok (DOI)</h3>
                <p>Deteksi dini resiko kehabisan stok (stockout) dan rekomendasi otomatis titik reorder.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Professional Clean Login Box */}
        <div className="erp-form-panel">
          <div className="login-box">
            <div className="login-box-header">
              <h2>{isRegister ? 'Daftar Akun Pengguna' : 'Masuk ke Akun Anda'}</h2>
              {isRegister && <p>Tentukan peran dan akses cabang gudang untuk akun baru Anda</p>}
            </div>

            {/* Quick Demo Account Selector Dropdown - Hide on Register */}
            {!isRegister && (
              <div className="quick-account-selector">
                <label htmlFor="demo-select">
                  <span className="material-symbols-outlined">key</span> Pilih Akun Demo (Quick Login):
                </label>
                <div className="select-wrapper">
                  <select
                    id="demo-select"
                    value={email}
                    onChange={handleSelectAccountChange}
                  >
                    {demoAccounts.map((acc, i) => (
                      <option key={i} value={acc.email}>
                        {acc.label} ({acc.email})
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined select-arrow">expand_more</span>
                </div>
              </div>
            )}

            {successMsg && (
              <div className="login-success-msg">
                <span className="material-symbols-outlined">check_circle</span>
                <span>{successMsg}</span>
              </div>
            )}

            {error && (
              <div className="login-error-msg">
                <span className="material-symbols-outlined">warning</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-form">
              {isRegister && (
                <>
                  <div className="form-field">
                    <label>Nama Lengkap</label>
                    <div className="input-group">
                      <span className="material-symbols-outlined input-icon">badge</span>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Contoh: Budi Santoso"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-field">
                    <label>Peran & Tanggung Jawab (Role)</label>
                    <div className="input-group">
                      <span className="material-symbols-outlined input-icon">manage_accounts</span>
                      <select
                        value={role}
                        onChange={e => {
                          const newRole = e.target.value;
                          setRole(newRole);
                          if (newRole === 'SUPER_ADMIN') {
                            setWarehouseId('all');
                          } else if (warehouseId === 'all') {
                            setWarehouseId(warehouses[0]?.id ? String(warehouses[0].id) : '1');
                          }
                        }}
                        required
                      >
                        {roleOptions.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined select-arrow">expand_more</span>
                    </div>
                    <div className="role-info-card">
                      <span className="material-symbols-outlined">info</span>
                      <span>{roleOptions.find(r => r.value === role)?.desc}</span>
                    </div>
                  </div>

                  <div className="form-field">
                    <label>Akses Cabang Gudang (Warehouse Assignment)</label>
                    <div className="input-group">
                      <span className="material-symbols-outlined input-icon">warehouse</span>
                      <select
                        value={warehouseId}
                        onChange={e => setWarehouseId(e.target.value)}
                        required
                      >
                        {role === 'SUPER_ADMIN' && (
                          <option value="all">🌐 Semua Gudang (Akses Global HQ)</option>
                        )}
                        {warehouses.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.city})
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined select-arrow">expand_more</span>
                    </div>
                    <div className="role-info-card" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>
                      <span className="material-symbols-outlined" style={{ color: '#16a34a' }}>domain</span>
                      <span>
                        {role === 'SUPER_ADMIN' && warehouseId === 'all'
                          ? 'Super Admin memiliki otoritas global ke seluruh cabang gudang.'
                          : `Akses pengguna akan dibatasi khusus pada ${warehouses.find(w => String(w.id) === String(warehouseId))?.name || 'gudang terpilih'}.`}
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div className="form-field">
                <label>Email / User ID</label>
                <div className="input-group">
                  <span className="material-symbols-outlined input-icon">person</span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="nama@stockflow.local"
                    required
                  />
                </div>
              </div>

              <div className="form-field">
                <div className="label-row">
                  <label>Kata Sandi</label>
                  {!isRegister && (
                    <a
                      href="#forgot"
                      onClick={e => {
                        e.preventDefault();
                        alert('Password default untuk semua akun tes adalah: admin123');
                      }}
                      className="forgot-password"
                    >
                      Lupa password?
                    </a>
                  )}
                </div>
                <div className="input-group">
                  <span className="material-symbols-outlined input-icon">lock</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={isRegister ? 'Minimal 6 karakter' : '••••••••'}
                    required
                  />
                  <button
                    type="button"
                    className="toggle-pwd-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Sembunyikan' : 'Tampilkan'}
                  >
                    <span className="material-symbols-outlined">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {!isRegister && (
                <div className="form-extra">
                  <label className="checkbox-label">
                    <input type="checkbox" defaultChecked />
                    <span>Ingat saya di perangkat ini</span>
                  </label>
                </div>
              )}

              <button type="submit" className="login-submit-btn" disabled={loading}>
                {loading ? (
                  <>
                    <span className="btn-spinner"></span> Memproses...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">{isRegister ? 'person_add' : 'login'}</span> {isRegister ? 'DAFTAR AKUN SEKARANG' : 'MASUK KE SISTEM'}
                  </>
                )}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.9rem' }}>
              {isRegister ? (
                <p>Sudah punya akun? <a href="#login" onClick={(e) => {
                  e.preventDefault();
                  setIsRegister(false);
                  setError('');
                  setSuccessMsg('');
                  setEmail('jakarta@stockflow.local');
                  setPassword('admin123');
                }}>Masuk di sini</a></p>
              ) : (
                <p>Belum punya akun? <a href="#register" onClick={(e) => {
                  e.preventDefault();
                  setIsRegister(true);
                  setError('');
                  setSuccessMsg('');
                  setEmail('');
                  setPassword('');
                  setName('');
                }}>Daftar akun baru di sini</a></p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      const token = localStorage.getItem('token');
      const saved = localStorage.getItem('stockflow_user');
      if (token && saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return null;
  });
  const [isVerifyingAuth, setIsVerifyingAuth] = useState(() => {
    return Boolean(localStorage.getItem('token') && !localStorage.getItem('stockflow_user'));
  });
  const [page, setPage] = useState(() => {
    return localStorage.getItem('stockflow_page') || 'Dashboard';
  });
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState(() => {
    return localStorage.getItem('stockflow_wh') || 'all';
  });
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [collapsed, setCollapsed] = useState(false);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    toastListener = (message, type = 'success') => {
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4500);
    };
    return () => { toastListener = null; };
  }, []);

  const removeToast = id => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('stockflow_wh', selectedWarehouse);
  }, [selectedWarehouse]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      apiCall('/auth/me')
        .then(userData => {
          if (userData && userData.id) {
            setUser(userData);
            localStorage.setItem('stockflow_user', JSON.stringify(userData));
          }
        })
        .catch(err => {
          console.warn('Session verification notice:', err.message);
          if (err.message && (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('inactive'))) {
            localStorage.removeItem('token');
            localStorage.removeItem('stockflow_user');
            setUser(null);
          }
        })
        .finally(() => {
          setIsVerifyingAuth(false);
        });
    } else {
      setIsVerifyingAuth(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      apiCall('/warehouses').then(setWarehouses).catch(() => {});
      loadPageData();
    }
  }, [user, page, selectedWarehouse]);

  async function loadPageData() {
    setLoading(true);
    try {
      const whQuery = user.role === 'SUPER_ADMIN' && selectedWarehouse !== 'all' ? `?warehouse_id=${selectedWarehouse}` : '';
      if (page === 'Dashboard') {
        const [dash, doi] = await Promise.all([apiCall(`/dashboard${whQuery}`), apiCall(`/analytics/doi${whQuery}`)]);
        setData({ dash, doi });
      } else if (page === 'Inventory') {
        setData({ rows: await apiCall(`/inventory${whQuery}`) });
      } else if (page === 'Warehouses') {
        setData({ warehouses: await apiCall('/warehouses') });
      } else if (page === 'Documents') {
        const [docs, wh, products, managers] = await Promise.all([
          apiCall(`/documents${whQuery}`),
          apiCall('/warehouses'),
          apiCall('/products'),
          apiCall(`/managers${whQuery}`)
        ]);
        setData({ docs, wh, products, managers });
      } else if (page === 'Stock Opname') {
        const [opname, wh, products] = await Promise.all([
          apiCall(`/stock-opname${whQuery}`),
          apiCall('/warehouses'),
          apiCall('/products')
        ]);
        setData({ opname, wh, products });
      } else if (page === 'Products') {
        setData({ products: await apiCall('/products') });
      } else if (page === 'Users') {
        const [users, wh] = await Promise.all([apiCall('/users'), apiCall('/warehouses')]);
        setData({ users, wh });
      } else if (page === 'Audit Trail') {
        setData({ logs: await apiCall(`/audit-logs${whQuery}`) });
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (isVerifyingAuth) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8fafc', color: '#0f172a' }}>
        <div className="btn-spinner" style={{ width: '36px', height: '36px', borderWidth: '3px', borderColor: 'rgba(2,132,199,0.2)', borderTopColor: '#0284c7' }}></div>
        <p style={{ marginTop: '16px', fontSize: '14px', fontWeight: 600, color: '#475569' }}>Memulihkan sesi login...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        <Login onLogin={(userData) => {
          localStorage.setItem('stockflow_user', JSON.stringify(userData));
          setUser(userData);
        }} />
      </>
    );
  }

  const menuItems = [
    { category: 'MAIN OPERATIONS', key: 'Dashboard', label: 'Dashboard', icon: 'grid_view' },
    { category: 'MAIN OPERATIONS', key: 'Warehouses', label: 'Warehouses', icon: 'domain' },
    { category: 'MAIN OPERATIONS', key: 'Inventory', label: 'Stock Inventory', icon: 'inventory_2' },
    { category: 'PROCUREMENT & STOCK', key: 'Documents', label: 'Purchase Order (PO)', icon: 'shopping_bag' },
    { category: 'PROCUREMENT & STOCK', key: 'Stock Opname', label: 'Stock Opname', icon: 'fact_check' },
    { category: 'PROCUREMENT & STOCK', key: 'Products', label: 'Master Catalog', icon: 'sell' },
    { category: 'SYSTEM & ADMIN', key: 'Analytics', label: 'DOI Analytics', icon: 'insights' },
    { category: 'SYSTEM & ADMIN', key: 'Users', label: 'Users & Roles', icon: 'group' },
    { category: 'SYSTEM & ADMIN', key: 'Audit Trail', label: 'Audit Logs', icon: 'history' }
  ];

  const currentWhName = user.role === 'SUPER_ADMIN'
    ? (selectedWarehouse === 'all' ? 'Semua Gudang (Global)' : (warehouses.find(w => String(w.id) === String(selectedWarehouse))?.name || `Gudang ID: ${selectedWarehouse}`))
    : (warehouses.find(w => String(w.id) === String(user.warehouse_id))?.name || `Gudang ID: ${user.warehouse_id}`);

  return (
    <>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="stockflow-layout">
      {/* StockFlow Topbar Header */}
      <header className="stockflow-topbar">
        <div className="stockflow-topbar-left">
          <button
            className="btn-sidebar-toggle"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand Menu" : "Collapse Menu"}
          >
            <span className="material-symbols-outlined">{collapsed ? 'menu_open' : 'menu'}</span>
          </button>

          <div className="stockflow-logo">
            <span className="material-symbols-outlined logo-icon">inventory_2</span>
            <span className="logo-title">STOCK FLOW <b>PRO</b></span>
          </div>

          {/* StockFlow Branch / Warehouse Scope Selector */}
          <div className="stockflow-branch-selector" title="Active Branch / Warehouse Scope">
            <span className="material-symbols-outlined">domain</span>
            <span className="branch-label">Scope:</span>
            {user.role === 'SUPER_ADMIN' ? (
              <select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value)}>
                <option value="all">Semua Gudang (Global)</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name} ({w.city})</option>
                ))}
              </select>
            ) : (
              <span className="branch-active-name">{currentWhName}</span>
            )}
          </div>
        </div>

        {/* StockFlow Quick Finder / Global Search */}
        <div className="stockflow-search-box">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="Search commands, screens, or SKUs..." />
        </div>

        <div className="stockflow-topbar-right">
          <button
            className="stockflow-icon-btn"
            onClick={() => showToast(`System Active | Logged in as ${user.name} (${user.role})`, 'info')}
            title="System Alerts & Notifications"
          >
            <span className="material-symbols-outlined">notifications</span>
          </button>

          <button
            className="stockflow-icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          </button>

          {/* User Profile Info */}
          <div className="stockflow-user-card" title={`Logged in as ${user.name} (${user.role})`}>
            <div className="avatar-circle">{user.name.charAt(0)}</div>
            <div className="stockflow-user-meta">
              <strong className="user-name">{user.name}</strong>
              <span className="user-role">{user.role}</span>
            </div>
          </div>

          {/* Logout Button */}
          <button
            className="stockflow-icon-btn btn-logout-stockflow"
            onClick={() => {
              localStorage.removeItem('token');
              localStorage.removeItem('stockflow_user');
              localStorage.removeItem('stockflow_page');
              setUser(null);
            }}
            title="Sign Out"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>

      <div className="stockflow-workspace">
        {/* Left Navigation Sidebar */}
        <aside className={`stockflow-sidebar ${collapsed ? 'collapsed' : ''}`}>
          <nav className="stockflow-nav">
            {['MAIN OPERATIONS', 'PROCUREMENT & STOCK', 'SYSTEM & ADMIN'].map(cat => {
              const catItems = menuItems.filter(item => item.category === cat && !(item.key === 'Users' && !['SUPER_ADMIN', 'MANAGER'].includes(user.role)));
              if (catItems.length === 0) return null;

              return (
                <div key={cat} className="nav-category-group">
                  {!collapsed && <div className="nav-category-title">{cat}</div>}
                  {catItems.map(item => (
                    <button
                      key={item.key}
                      className={page === item.key ? 'stockflow-nav-item active' : 'stockflow-nav-item'}
                      onClick={() => {
                        setPage(item.key);
                        localStorage.setItem('stockflow_page', item.key);
                      }}
                      title={item.label}
                    >
                      <span className="material-symbols-outlined nav-icon">{item.icon}</span>
                      <span className="nav-text">{item.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>

          {!collapsed && (
            <div className="sidebar-bottom-info">
              <div className="system-live-badge">
                <span className="live-dot"></span>
                <span>MULTI-WAREHOUSE ONLINE</span>
              </div>
              <small style={{ fontSize: '9.5px', color: 'var(--text-muted)' }}>StockFlow Pro v2.4 Enterprise</small>
            </div>
          )}
        </aside>

        {/* Main Content Workspace */}
        <main className="stockflow-content">
          <div className="stockflow-body">
            {loading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Loading STOCK FLOW PRO...</p>
              </div>
            ) : (
              <PageComponent page={page} data={data} reload={loadPageData} user={user} selectedWarehouse={selectedWarehouse} />
            )}
          </div>
        </main>
      </div>
    </div>
  </>
);
}

function PageComponent({ page, data, reload, user, selectedWarehouse }) {
  if (page === 'Dashboard') {
    const d = data.dash || {};
    const a = data.doi || {};
    const chartData = [
      { name: 'Critical', value: a.critical || 0, color: '#ef4444' },
      { name: 'Healthy', value: a.healthy || 0, color: '#10b981' },
      { name: 'Slow', value: a.slow || 0, color: '#f59e0b' },
      { name: 'Overstock', value: a.overstock || 0, color: '#3b82f6' },
      { name: 'No Sales', value: a.no_sales || 0, color: '#6b7280' }
    ];

    return (
      <div className="dashboard-view">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="label">Total Stock On Hand</span>
              <div className="icon-box"><span className="material-symbols-outlined">warehouse</span></div>
            </div>
            <strong className="value">{d.total_stock?.toLocaleString() || 0}</strong>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="label">Monitored SKUs</span>
              <div className="icon-box"><span className="material-symbols-outlined">category</span></div>
            </div>
            <strong className="value">{d.sku_count || 0}</strong>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="label">Inbound Today</span>
              <div className="icon-box"><span className="material-symbols-outlined">download_for_offline</span></div>
            </div>
            <strong className="value text-success">+{d.inbound_today || 0}</strong>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="label">Outbound Today</span>
              <div className="icon-box"><span className="material-symbols-outlined">upload_file</span></div>
            </div>
            <strong className="value text-danger">-{d.outbound_today || 0}</strong>
          </div>
          <div className="stat-card highlight-danger">
            <div className="stat-card-header">
              <span className="label">Critical DOI Alerts</span>
              <div className="icon-box" style={{ background: 'rgba(244, 63, 94, 0.15)', color: '#f43f5e' }}><span className="material-symbols-outlined">warning</span></div>
            </div>
            <strong className="value text-danger">{a.critical || 0}</strong>
          </div>
        </div>

        <div className="panel-grid">
          <div className="panel">
            <h3>Days of Inventory (DOI) Health Overview</h3>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value">
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3>Low Stock & DOI Alerts</h3>
            <DataTable
              rows={d.alerts || []}
              columns={[
                { key: 'sku', title: 'SKU' },
                { key: 'product_name', title: 'Product' },
                { key: 'warehouse', title: 'Warehouse' },
                { key: 'stock_on_hand', title: 'Stock' },
                { key: 'ads30', title: 'ADS 30d' },
                { key: 'doi30', title: 'DOI (Days)' }
              ]}
            />
          </div>
        </div>
      </div>
    );
  }

  if (page === 'Inventory') {
    return <InventoryView data={data} reload={reload} user={user} selectedWarehouse={selectedWarehouse} />;
  }

  if (page === 'Products') {
    return <ProductsView data={data} reload={reload} user={user} />;
  }

  if (page === 'Stock Opname') {
    return <StockOpnameView data={data} reload={reload} user={user} />;
  }

  if (page === 'Analytics') {
    return (
      <div className="panel">
        <h3>Days of Inventory (DOI) Analytics Engine</h3>
        <div className="formula-card">
          <h4>Formula & Rules</h4>
          <p><b>Average Daily Sales (ADS 30):</b> Sum of Sales in Last 30 Days ÷ 30</p>
          <p><b>Days of Inventory (DOI 30):</b> Current Stock On Hand ÷ ADS 30</p>
        </div>
        <button className="btn-primary" onClick={reload}>
          <span className="material-symbols-outlined">sync</span> Recalculate Analytics
        </button>
      </div>
    );
  }

  if (page === 'Warehouses') {
    return <WarehousesView data={data} reload={reload} user={user} />;
  }

  if (page === 'Users') {
    return <UsersView data={data} reload={reload} user={user} />;
  }

  if (page === 'Audit Trail') {
    return (
      <div className="page-view-full">
        <div className="page-header-bar">
          <h2><span className="material-symbols-outlined">history</span> System Audit Trail Logs</h2>
        </div>
        <DataTable
          rows={data.logs || []}
          columns={[
            { key: 'created_at', title: 'Timestamp' },
            { key: 'user_name', title: 'User' },
            { key: 'action', title: 'Action' },
            { key: 'entity', title: 'Entity' },
            { key: 'entity_id', title: 'Entity ID' },
            { key: 'detail', title: 'Details' }
          ]}
        />
      </div>
    );
  }

  if (page === 'Documents') {
    return <DocumentsView data={data} reload={reload} user={user} />;
  }

  return null;
}

function InventoryView({ data, reload, user, selectedWarehouse }) {
  const [selectedProductHistory, setSelectedProductHistory] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function openHistory(product) {
    setSelectedProductHistory(product);
    setLoadingHistory(true);
    try {
      const res = await apiCall(`/inventory/history?sku=${encodeURIComponent(product.sku)}`);
      setHistoryData(res);
    } catch (err) {
      showToast(err.message, 'error');
    }
    setLoadingHistory(false);
  }

  if (selectedProductHistory) {
    const historyRows = (historyData?.movements || []).concat(
      (historyData?.audit || []).map(a => ({
        doc_number: 'AUDIT LOG',
        doc_type: a.doc_type,
        status: 'RECORDED',
        timestamp: a.timestamp,
        warehouse_name: selectedProductHistory.warehouse,
        quantity: '-',
        actor_name: a.actor_name
      }))
    );

    return (
      <div className="page-view-full" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* StockFlow Screen Title Bar with Navigation Back */}
        <div className="stockflow-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="stockflow-title-left" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              className="btn-secondary"
              onClick={() => setSelectedProductHistory(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '700', padding: '6px 14px' }}
            >
              <span className="material-symbols-outlined">arrow_back</span> Kembali ke Stock Inventory
            </button>
            <div>
              <span className="screen-category">Stock Management / Item History</span>
              <h1 className="screen-main-title">Stock Movement History: {selectedProductHistory.sku}</h1>
            </div>
          </div>
          <div className="stockflow-top-utility">
            <button className="btn-secondary" onClick={() => openHistory(selectedProductHistory)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined">refresh</span> Refresh Log History
            </button>
          </div>
        </div>

        {/* Top Summary Header Form Panel */}
        <div className="stockflow-form-panel">
          <div className="stockflow-form-header-title">
            <span className="material-symbols-outlined">info</span> SPECIFICATIONS & CURRENT STOCK BALANCE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', padding: '12px 0' }}>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontSize: '11px', fontWeight: '700' }}>SKU / BARCODE</small>
              <div style={{ fontWeight: '800', color: 'var(--primary)', fontSize: '15px' }}>
                {selectedProductHistory.sku} ({selectedProductHistory.barcode || '-'})
              </div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontSize: '11px', fontWeight: '700' }}>PRODUCT NAME</small>
              <div style={{ fontWeight: '800', fontSize: '15px', color: 'var(--text-heading)' }}>{selectedProductHistory.product_name}</div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontSize: '11px', fontWeight: '700' }}>WAREHOUSE</small>
              <div style={{ fontWeight: '800', color: 'var(--text-heading)' }}>{selectedProductHistory.warehouse}</div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontSize: '11px', fontWeight: '700' }}>CURRENT STOCK ON HAND</small>
              <div style={{ fontWeight: '800', color: 'var(--success)', fontSize: '16px' }}>
                {selectedProductHistory.stock_on_hand} {selectedProductHistory.unit || 'PCS'}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Header & Data Grid */}
        <div className="stockflow-tab-wrapper">
          <div className="stockflow-tab-header">
            <button className="stockflow-tab-btn active">
              <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '6px' }}>history</span>
              Document Movements & System Audit Logs
            </button>
          </div>
          <div className="stockflow-tab-content">
            {loadingHistory ? (
              <div className="loading-state" style={{ padding: '60px' }}>
                <div className="spinner"></div>
                <p>Loading Stock Movement History...</p>
              </div>
            ) : (
              <DataTable
                rows={historyRows}
                title={`stock_movement_ledger_${selectedProductHistory.sku}`}
                onRefresh={() => openHistory(selectedProductHistory)}
                columns={[
                  { key: 'timestamp', title: 'Timestamp' },
                  { key: 'doc_number', title: 'Doc Ref #' },
                  {
                    key: 'doc_type',
                    title: 'Movement Type',
                    render: row => (
                      <span className="badge-pro" style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '3px 8px', borderRadius: '4px' }}>
                        {row.doc_type}
                      </span>
                    )
                  },
                  { key: 'warehouse_name', title: 'Warehouse' },
                  {
                    key: 'quantity',
                    title: 'Qty',
                    render: row => (
                      <b style={{ color: Number(row.quantity) > 0 ? 'var(--success)' : (row.quantity === '-' ? 'var(--text-muted)' : 'var(--danger)') }}>
                        {Number(row.quantity) > 0 ? `+${row.quantity}` : row.quantity}
                      </b>
                    )
                  },
                  {
                    key: 'status',
                    title: 'Status',
                    render: row => <span className="status-pill pill-approved">{row.status}</span>
                  },
                  { key: 'actor_name', title: 'Executed By' }
                ]}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-view-full">
      <div className="stockflow-title-bar">
        <div className="stockflow-title-left">
          <span className="screen-category">Stock Management</span>
          <h1 className="screen-main-title">Stock Inventory Status & Movement History</h1>
        </div>
      </div>

      <DataTable
        rows={data.rows || []}
        title="inventory_stock_status"
        onRefresh={reload}
        action={row => (
          <button
            className="grid-action-btn"
            onClick={() => openHistory(row)}
            title="View Stock Movement History Page"
            style={{ color: 'var(--primary)', cursor: 'pointer' }}
          >
            <span className="material-symbols-outlined">history</span>
          </button>
        )}
        columns={[
          { key: 'warehouse', title: 'Warehouse' },
          {
            key: 'sku',
            title: 'SKU',
            render: row => (
              <button
                type="button"
                onClick={() => openHistory(row)}
                title="Click to view stock movement history page"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary)',
                  fontWeight: '800',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0
                }}
              >
                {row.sku}
              </button>
            )
          },
          { key: 'barcode', title: 'Barcode' },
          { key: 'product_name', title: 'Product' },
          {
            key: 'variant',
            title: 'Variant',
            render: row => (
              <span className="badge-pro" style={{ background: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid var(--border-glow)' }}>
                {row.variant || '-'}
              </span>
            )
          },
          { key: 'brand', title: 'Brand' },
          {
            key: 'batch_number',
            title: 'Batch #',
            render: row => (
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: '700', color: 'var(--text-heading)' }}>
                {row.batch_number || '-'}
              </span>
            )
          },
          {
            key: 'exp_date',
            title: 'Exp Date',
            render: row => (
              <span style={{ color: row.exp_date ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: '600' }}>
                {row.exp_date || '-'}
              </span>
            )
          },
          { key: 'stock_on_hand', title: 'Stock On Hand' },
          { key: 'ads7', title: 'ADS 7d' },
          { key: 'ads30', title: 'ADS 30d' },
          { key: 'doi30', title: 'DOI (Days)' },
          {
            key: 'status',
            title: 'Status',
            render: row => {
              const statusStr = String(row?.status || 'ACTIVE');
              return (
                <span className={`status-pill pill-${statusStr.toLowerCase().replace(/\s+/g, '-')}`}>
                  {statusStr}
                </span>
              );
            }
          }
        ]}
      />
    </div>
  );
}

function ProductsView({ data, reload, user }) {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [form, setForm] = useState({
    sku: '',
    barcode: '',
    product_name: '',
    variant: '',
    category: '',
    brand: '',
    unit: '',
    min_stock: '',
    reorder_point: '',
    retail_price: '',
    hpp: ''
  });

  const canEdit = ['SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN'].includes(user.role);

  function handleResetForm() {
    setSelectedProduct(null);
    setForm({
      sku: '',
      barcode: '',
      product_name: '',
      variant: '',
      category: '',
      brand: '',
      unit: '',
      min_stock: '',
      reorder_point: '',
      retail_price: '',
      hpp: ''
    });
  }

  function handleSelectRow(product) {
    setSelectedProduct(product);
    setForm({
      id: product.id,
      sku: product.sku || '',
      barcode: product.barcode || '',
      product_name: product.product_name || '',
      variant: product.variant || '',
      category: product.category || '',
      brand: product.brand || '',
      unit: product.unit || '',
      min_stock: product.min_stock ?? '',
      reorder_point: product.reorder_point ?? '',
      retail_price: product.retail_price ?? '',
      hpp: product.hpp ?? ''
    });
  }

  async function handleSaveProduct(e) {
    e?.preventDefault();
    if (
      !String(form.sku || '').trim() ||
      !String(form.barcode || '').trim() ||
      !String(form.product_name || '').trim() ||
      !String(form.variant || '').trim() ||
      !String(form.category || '').trim() ||
      !String(form.brand || '').trim() ||
      !String(form.unit || '').trim() ||
      form.min_stock === '' || form.min_stock === null || form.min_stock === undefined ||
      form.reorder_point === '' || form.reorder_point === null || form.reorder_point === undefined ||
      form.retail_price === '' || form.retail_price === null || form.retail_price === undefined ||
      form.hpp === '' || form.hpp === null || form.hpp === undefined
    ) {
      return showToast('Semua kolom yang diinput manual wajib diisi secara lengkap!', 'error');
    }
    try {
      await apiCall('/products', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      showToast(`Produk "${form.product_name}" (${form.sku}) berhasil disimpan!`, 'success');
      handleResetForm();
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div className="stockflow-screen-wrapper">
      {/* StockFlow Screen Category & Main Title */}
      <div className="stockflow-title-bar">
        <div className="stockflow-title-left">
          <span className="screen-category">Master Catalog Management</span>
          <h1 className="screen-main-title">
            {selectedProduct ? `Master Product Item: ${selectedProduct.sku}` : 'Master Product Catalog & Entry Form'}
          </h1>
        </div>
      </div>

      {/* StockFlow Primary Action Toolbar */}
      <div className="stockflow-screen-toolbar">
        <div className="stockflow-toolbar-left">
          {canEdit && (
            <button className="stockflow-tool-btn" onClick={handleSaveProduct} title="Save Record (Ctrl+S)">
              <span className="material-symbols-outlined">save</span>
            </button>
          )}
          <button className="stockflow-tool-btn" onClick={handleResetForm} title="New / Clear Form">
            <span className="material-symbols-outlined">add_box</span>
          </button>
          <button className="stockflow-tool-btn" onClick={reload} title="Refresh Data">
            <span className="material-symbols-outlined">refresh</span>
          </button>

          <div className="stockflow-toolbar-divider"></div>

          {canEdit && (
            <button className="btn-release" onClick={handleSaveProduct}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>save</span>
              SAVE & REGISTER PRODUCT
            </button>
          )}
          {selectedProduct && (
            <button className="btn-secondary" style={{ marginLeft: '8px' }} onClick={handleResetForm}>
              + NEW PRODUCT ENTRY
            </button>
          )}
        </div>
      </div>

      {/* StockFlow Summary Header Form Panel (Form Atas) */}
      <div className="stockflow-form-panel">
        <div className="stockflow-form-header-title">
          <span className="material-symbols-outlined">inventory</span>
          <span>PRODUCT DETAIL ENTRY FORM</span>
        </div>

        <form onSubmit={handleSaveProduct} className="stockflow-form-grid-3col">
          {/* Column 1 */}
          <div className="form-col">
            <div className="form-group-compact">
              <label>SKU Code <span className="req">*</span></label>
              <input
                type="text"
                value={form.sku}
                onChange={e => setForm({ ...form, sku: e.target.value })}
                placeholder="e.g. SKU005"
                required
              />
            </div>
            <div className="form-group-compact">
              <label>Barcode / EAN <span className="req">*</span></label>
              <input
                type="text"
                value={form.barcode}
                onChange={e => setForm({ ...form, barcode: e.target.value })}
                placeholder="e.g. 899005"
                required
              />
            </div>
            <div className="form-group-compact">
              <label>Product Name <span className="req">*</span></label>
              <input
                type="text"
                value={form.product_name}
                onChange={e => setForm({ ...form, product_name: e.target.value })}
                placeholder="e.g. Hydrating Facial Wash"
                required
              />
            </div>
            <div className="form-group-compact highlight-group">
              <label style={{ color: 'var(--primary)', fontWeight: '700' }}>Variant <span className="req">*</span></label>
              <input
                type="text"
                value={form.variant}
                onChange={e => setForm({ ...form, variant: e.target.value })}
                placeholder="e.g. 250ml Pump / SPF 50"
                required
              />
            </div>
          </div>

          {/* Column 2 */}
          <div className="form-col">
            <div className="form-group-compact">
              <label>Category <span className="req">*</span></label>
              <input
                type="text"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Skincare"
                required
              />
            </div>
            <div className="form-group-compact">
              <label>Brand <span className="req">*</span></label>
              <input
                type="text"
                value={form.brand}
                onChange={e => setForm({ ...form, brand: e.target.value })}
                placeholder="e.g. ELMIA"
                required
              />
            </div>
            <div className="form-group-compact">
              <label>Reorder Point <span className="req">*</span></label>
              <input
                type="number"
                value={form.reorder_point}
                onChange={e => setForm({ ...form, reorder_point: e.target.value === '' ? '' : +e.target.value })}
                placeholder="e.g. 500"
                required
              />
            </div>
          </div>

          {/* Column 3 */}
          <div className="form-col">
            <div className="form-group-compact">
              <label>Unit <span className="req">*</span></label>
              <input
                type="text"
                value={form.unit}
                onChange={e => setForm({ ...form, unit: e.target.value })}
                placeholder="PCS"
                required
              />
            </div>
            <div className="form-group-compact">
              <label>Min Stock <span className="req">*</span></label>
              <input
                type="number"
                value={form.min_stock}
                onChange={e => setForm({ ...form, min_stock: e.target.value === '' ? '' : +e.target.value })}
                placeholder="e.g. 100"
                required
              />
            </div>
            <div className="form-group-compact highlight-group">
              <label style={{ color: 'var(--success)', fontWeight: '700' }}>Retail Price (Rp) <span className="req">*</span></label>
              <input
                type="number"
                value={form.retail_price}
                onChange={e => setForm({ ...form, retail_price: e.target.value === '' ? '' : +e.target.value })}
                placeholder="e.g. 150000"
                required
              />
            </div>
            <div className="form-group-compact">
              <label style={{ color: 'var(--warning)', fontWeight: '700' }}>HPP Cost (Rp) <span className="req">*</span></label>
              <input
                type="number"
                value={form.hpp}
                onChange={e => setForm({ ...form, hpp: e.target.value === '' ? '' : +e.target.value })}
                placeholder="e.g. 95000"
                required
              />
            </div>
          </div>
        </form>
      </div>

      {/* StockFlow Tab Navigation */}
      <div className="stockflow-tabs-bar">
        <button className="stockflow-tab-btn active">
          <span className="material-symbols-outlined">list_alt</span> MASTER PRODUCT CATALOG & VARIANTS
        </button>
      </div>

      {/* Spreadsheet Data Grid */}
      <DataTable
        rows={data.products || []}
        title="master_product_catalog"
        onRefresh={reload}
        action={row => (
          <button
            className="grid-action-btn"
            onClick={() => handleSelectRow(row)}
            title="Edit / Select in Header Form"
            style={{ color: 'var(--primary)', cursor: 'pointer' }}
          >
            <span className="material-symbols-outlined">edit</span>
          </button>
        )}
        columns={[
          { key: 'sku', title: 'SKU' },
          { key: 'barcode', title: 'Barcode' },
          { key: 'product_name', title: 'Product Name' },
          {
            key: 'variant',
            title: 'Variant',
            render: row => (
              <span className="badge-pro" style={{ background: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid var(--border-glow)' }}>
                {row.variant || '-'}
              </span>
            )
          },
          { key: 'category', title: 'Category' },
          { key: 'brand', title: 'Brand' },
          { key: 'unit', title: 'Unit' },
          {
            key: 'retail_price',
            title: 'Retail Price',
            render: row => (
              <span style={{ color: 'var(--success)', fontWeight: '700' }}>
                {row.retail_price ? 'Rp ' + Number(row.retail_price).toLocaleString('id-ID') : 'Rp 0'}
              </span>
            )
          },
          {
            key: 'hpp',
            title: 'HPP (Cost)',
            render: row => (
              <span style={{ color: 'var(--warning)', fontWeight: '600' }}>
                {row.hpp ? 'Rp ' + Number(row.hpp).toLocaleString('id-ID') : 'Rp 0'}
              </span>
            )
          },
          { key: 'min_stock', title: 'Min Stock' },
          { key: 'reorder_point', title: 'Reorder Point' }
        ]}
      />
    </div>
  );
}

function generateDocNumber(type = 'PO_PRODUCT') {
  const prefix = {
    PO_PRODUCT: 'PO-PRD',
    PO_OPERATIONAL: 'PO-OPS',
    INBOUND: 'PO',
    OUTBOUND: 'OUT',
    TRANSFER: 'TRF'
  }[type] || 'PO';
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const randomSuffix = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${dateStr}-${randomSuffix}`;
}

function DocumentsView({ data, reload, user }) {
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({
    doc_type: 'PO_PRODUCT',
    doc_number: generateDocNumber('PO_PRODUCT'),
    warehouse_id: String(user.warehouse_id || '1'),
    destination_warehouse_id: '',
    partner: '',
    assigned_manager_id: ''
  });

  const [lineItems, setLineItems] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const isManager = ['SUPER_ADMIN', 'MANAGER'].includes(user.role);

  useEffect(() => {
    if (user.warehouse_id && user.role !== 'SUPER_ADMIN') {
      setForm(f => ({
        ...f,
        warehouse_id: String(user.warehouse_id),
        destination_warehouse_id: ''
      }));
    }
  }, [user]);

  useEffect(() => {
    if (data.managers && data.managers.length > 0 && !form.assigned_manager_id) {
      setForm(f => ({ ...f, assigned_manager_id: String(data.managers[0].id) }));
    }
  }, [data.managers]);

  function startCreateNewDoc() {
    setIsCreating(true);
    const defaultType = 'PO_PRODUCT';
    setForm(f => ({
      ...f,
      doc_type: defaultType,
      doc_number: generateDocNumber(defaultType)
    }));
    setLineItems([]); // Start with empty line items list as requested
  }

  function handleAddLineRow() {
    setLineItems(prev => {
      const nextIdx = prev.length;
      setTimeout(() => {
        const nextSelect = document.getElementById(`sku-select-${nextIdx}`);
        if (nextSelect) nextSelect.focus();
      }, 50);
      return [
        ...prev,
        {
          product_id: '',
          sku: '',
          barcode: '',
          product_name: '',
          variant: '',
          brand: '',
          unit: '',
          quantity: '',
          price: ''
        }
      ];
    });
  }

  function handleKeyDownSku(e, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      setTimeout(() => {
        const qtyEl = document.getElementById(`qty-input-${index}`);
        if (qtyEl) {
          qtyEl.focus();
          qtyEl.select?.();
        }
      }, 50);
    }
  }

  function handleKeyDownQty(e, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const priceEl = document.getElementById(`price-input-${index}`);
      if (priceEl) {
        priceEl.focus();
        priceEl.select?.();
      }
    }
  }

  function handleKeyDownPrice(e, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (index === lineItems.length - 1) {
        handleAddLineRow();
      } else {
        const nextSelect = document.getElementById(`sku-select-${index + 1}`);
        if (nextSelect) nextSelect.focus();
      }
    }
  }

  function handleRemoveLineRow(index) {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  }

  function handleSelectProductInRow(index, productId) {
    if (!productId) {
      setLineItems(prev => {
        const updated = [...prev];
        updated[index] = {
          product_id: '',
          sku: '',
          barcode: '',
          product_name: '',
          variant: '',
          brand: '',
          unit: '',
          quantity: '',
          price: ''
        };
        return updated;
      });
      return;
    }

    const prod = (data.products || []).find(p => String(p.id) === String(productId));
    if (!prod) return;

    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        product_id: String(prod.id),
        sku: prod.sku || '',
        barcode: prod.barcode || '',
        product_name: prod.product_name || '',
        variant: prod.variant || '',
        brand: prod.brand || '',
        unit: prod.unit || 'PCS',
        quantity: updated[index].quantity !== '' && updated[index].quantity !== undefined ? updated[index].quantity : '',
        price: form.doc_type === 'OUTBOUND' ? (prod.retail_price || 0) : (prod.hpp || 0)
      };
      setTimeout(() => {
        const qtyEl = document.getElementById(`qty-input-${index}`);
        if (qtyEl) {
          qtyEl.focus();
          qtyEl.select?.();
        }
      }, 50);
      return updated;
    });
  }

  function handleUpdateLineItem(index, field, value) {
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }

  async function handleCreate() {
    const validItems = lineItems.filter(item => item.product_id && Number(item.quantity) > 0);
    if (!validItems.length) return showToast('Silakan tambahkan minimal 1 produk dan isi Jumlah (Qty) barang dengan benar.', 'error');
    try {
      await apiCall('/inbounds', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: form.doc_type,
          doc_number: form.doc_number,
          warehouse_id: +form.warehouse_id,
          partner: form.partner,
          assigned_manager_id: form.assigned_manager_id ? +form.assigned_manager_id : null,
          items: validItems.map(item => ({ product_id: +item.product_id, quantity: +item.quantity, price: Number(item.price) || 0 }))
        })
      });
      showToast(`Purchase Order ${form.doc_number} berhasil dibuat dan dikirim ke Manager untuk Approval!`, 'success');
      setIsCreating(false);
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleApprove(id) {
    try {
      await apiCall(`/documents/${id}/approve`, { method: 'POST' });
      showToast('Purchase Order APPROVED successfully!', 'success');
      reload();
      if (selectedDoc && selectedDoc.id === id) setSelectedDoc(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleReject(id) {
    const reason = prompt('Enter rejection reason for this Purchase Order:');
    if (reason === null) return;
    try {
      await apiCall(`/documents/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      showToast('Purchase Order REJECTED.', 'error');
      reload();
      if (selectedDoc && selectedDoc.id === id) setSelectedDoc(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleToggleRejectItem(itemId) {
    try {
      const res = await apiCall(`/document-items/${itemId}/toggle-reject`, { method: 'POST' });
      showToast(res.message, 'success');
      if (selectedDoc) {
        setSelectedDoc(prev => {
          if (!prev) return null;
          return {
            ...prev,
            items: (prev.items || []).map(it => it.id === itemId ? { ...it, is_rejected: res.is_rejected } : it)
          };
        });
      }
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleReceive(id) {
    try {
      await apiCall(`/transfers/${id}/receive`, { method: 'POST' });
      showToast('Goods RECEIVED at destination warehouse!', 'success');
      reload();
      if (selectedDoc && selectedDoc.id === id) setSelectedDoc(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const [activeTab, setActiveTab] = useState('ALL DOCUMENTS');

  const filteredDocs = (data.docs || []).filter(doc => {
    if (activeTab === 'PENDING MANAGER') return doc.status === 'PENDING_APPROVAL';
    if (activeTab === 'IN TRANSIT') return doc.status === 'IN_TRANSIT';
    if (activeTab === 'APPROVED') return doc.status === 'APPROVED';
    if (activeTab === 'REJECTED') return doc.status === 'REJECTED';
    return true;
  });

  if (selectedDoc) {
    const totalItems = selectedDoc.items ? selectedDoc.items.length : 0;
    const totalQty = (selectedDoc.items || []).reduce((acc, item) => item.is_rejected ? acc : acc + (Number(item.quantity) || 0), 0);
    const totalUnitCostSum = (selectedDoc.items || []).reduce((acc, item) => {
      if (item.is_rejected) return acc;
      return acc + Number(item.unit_price || item.price || item.hpp || item.retail_price || 0);
    }, 0);
    const totalPrice = (selectedDoc.items || []).reduce((acc, item) => {
      if (item.is_rejected) return acc;
      const unitCost = Number(item.unit_price || item.price || item.hpp || item.retail_price || 0);
      return acc + ((Number(item.quantity) || 0) * unitCost);
    }, 0);

    return (
      <div className="page-view-full" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* StockFlow Screen Title Bar with Back Button */}
        <div className="stockflow-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="stockflow-title-left">
            <span className="screen-category">Procurement / Purchase Order Review</span>
            <h1 className="screen-main-title" style={{ fontSize: '15px' }}>Detail Review Purchase Order: {selectedDoc.doc_number}</h1>
          </div>
        </div>

        {/* Stepper Header */}
        <div className="stockflow-form-panel">
          <div className="workflow-stepper" style={{ padding: '16px 0' }}>
            <div className={`step-item ${selectedDoc.status !== 'DRAFT' ? 'completed' : 'active'}`}>
              <div className="circle">1</div>
              <div className="step-label">Submitted</div>
              <small>{selectedDoc.creator_name || 'Admin'}</small>
            </div>
            <div className="step-line"></div>

            <div className={`step-item ${['APPROVED', 'IN_TRANSIT', 'RECEIVED'].includes(selectedDoc.status) ? 'completed' : (selectedDoc.status === 'PENDING_APPROVAL' ? 'active' : (selectedDoc.status === 'REJECTED' ? 'rejected' : ''))}`}>
              <div className="circle">2</div>
              <div className="step-label">Manager Review</div>
              <small>{selectedDoc.assigned_manager_name || 'Manager'}</small>
            </div>
            <div className="step-line"></div>

            <div className={`step-item ${['APPROVED', 'IN_TRANSIT', 'RECEIVED'].includes(selectedDoc.status) ? 'completed' : ''}`}>
              <div className="circle">3</div>
              <div className="step-label">{selectedDoc.doc_type === 'TRANSFER' ? 'In-Transit' : 'Approved'}</div>
              <small>{selectedDoc.approver_name || 'Approver'}</small>
            </div>
            <div className="step-line"></div>

            <div className={`step-item ${selectedDoc.status === 'RECEIVED' || (selectedDoc.status === 'APPROVED' && selectedDoc.doc_type !== 'TRANSFER') ? 'completed' : ''}`}>
              <div className="circle">4</div>
              <div className="step-label">Completed</div>
              <small>Stock Updated</small>
            </div>
          </div>
        </div>

        {/* Status Alert */}
        {selectedDoc.status === 'REJECTED' && (
          <div className="alert-box alert-danger">
            <strong><span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '6px' }}>cancel</span> REQUEST REJECTED BY MANAGER</strong>
            <p>Reason: {selectedDoc.rejection_reason || 'No specific reason specified'}</p>
          </div>
        )}

        {selectedDoc.status === 'PENDING_APPROVAL' && (
          <div className="alert-box alert-warning">
            <strong><span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '6px' }}>schedule</span> WAITING FOR MANAGER REVIEW & APPROVAL</strong>
            <p>Anda dapat **Menolak (Reject) produk per satuan baris** pada tabel di bawah ini sebelum menyetujui (Approve) dokumen ini.</p>
          </div>
        )}

        {/* Top Summary Info Card */}
        <div className="stockflow-form-panel">
          <div className="stockflow-form-header-title">
            <span className="material-symbols-outlined">info</span> SPECIFICATIONS & DOCUMENT SUMMARY
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', padding: '8px 0' }}>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '10px', fontWeight: '700' }}>PO NUMBER</small>
              <div style={{ fontWeight: '800', color: 'var(--primary)', fontFamily: 'monospace', fontSize: '13px' }}>{selectedDoc.doc_number}</div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '10px', fontWeight: '700' }}>TARGET WAREHOUSE</small>
              <div style={{ fontWeight: '800', fontSize: '13px', color: 'var(--text-heading)' }}>{selectedDoc.warehouse}</div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '10px', fontWeight: '700' }}>VENDOR / SUPPLIER</small>
              <div style={{ fontWeight: '800', fontSize: '13px', color: 'var(--text-heading)' }}>{selectedDoc.partner || '-'}</div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '10px', fontWeight: '700' }}>REQUESTED BY</small>
              <div style={{ fontWeight: '800', fontSize: '13px', color: 'var(--text-heading)' }}>{selectedDoc.creator_name || '-'}</div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '10px', fontWeight: '700' }}>ASSIGNED MANAGER</small>
              <div style={{ fontWeight: '800', fontSize: '13px', color: 'var(--text-heading)' }}>{selectedDoc.assigned_manager_name || '-'}</div>
            </div>
            <div>
              <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '10px', fontWeight: '700' }}>TOTAL APPROVED QTY / VALUE</small>
              <div style={{ fontWeight: '800', color: 'var(--success)', fontSize: '13px' }}>
                {totalQty.toLocaleString()} PCS (Rp {totalPrice.toLocaleString('id-ID')})
              </div>
            </div>
          </div>
        </div>

        {/* Item Detail Table View */}
        <div className="stockflow-tab-wrapper">
          <div className="stockflow-tab-header">
            <button className="stockflow-tab-btn active">
              <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '6px' }}>format_list_bulleted</span>
              DETAIL LIST BARANG DIBELI & SATUAN REVIEW STATUS
            </button>
          </div>

          <div className="stockflow-tab-content" style={{ padding: '12px' }}>
            <div className="table-responsive">
              <table className="excel-data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                    <th>SKU / Barcode</th>
                    <th>Nama Produk</th>
                    <th>Varian</th>
                    <th>Brand</th>
                    <th style={{ textAlign: 'right' }}>Qty Requested</th>
                    <th style={{ textAlign: 'right' }}>Est. Unit Cost (Rp)</th>
                    <th style={{ textAlign: 'right' }}>Subtotal (Rp)</th>
                    <th style={{ textAlign: 'center' }}>Status Item</th>
                    {isManager && selectedDoc.status === 'PENDING_APPROVAL' && <th style={{ textAlign: 'center', width: '150px' }}>Aksi Review Item</th>}
                  </tr>
                </thead>
                <tbody>
                  {(selectedDoc.items || []).map((item, idx) => {
                    const unitCost = Number(item.unit_price || item.price || item.hpp || item.retail_price || 0);
                    const subtotal = (Number(item.quantity) || 0) * unitCost;
                    const isRejected = Boolean(item.is_rejected);

                    return (
                      <tr key={idx} style={{ background: isRejected ? 'rgba(239, 68, 68, 0.07)' : 'transparent' }}>
                        <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                        <td><b style={{ color: isRejected ? 'var(--danger)' : 'var(--primary)', textDecoration: isRejected ? 'line-through' : 'none' }}>{item.sku}</b></td>
                        <td style={{ textDecoration: isRejected ? 'line-through' : 'none', color: isRejected ? 'var(--text-muted)' : 'inherit' }}>{item.product_name}</td>
                        <td>{item.variant || '-'}</td>
                        <td>{item.brand || '-'}</td>
                        <td style={{ textAlign: 'right', fontWeight: '700' }}>{item.quantity} {item.unit}</td>
                        <td style={{ textAlign: 'right' }}>Rp {unitCost.toLocaleString('id-ID')}</td>
                        <td style={{ textAlign: 'right', fontWeight: '800', color: isRejected ? 'var(--text-muted)' : 'var(--success)' }}>
                          Rp {subtotal.toLocaleString('id-ID')}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {isRejected ? (
                            <span className="status-pill pill-rejected" style={{ fontSize: '10px', padding: '2px 8px' }}>❌ DITOLAK (REJECTED)</span>
                          ) : (
                            <span className="status-pill pill-approved" style={{ fontSize: '10px', padding: '2px 8px' }}>✅ DISETUJUI</span>
                          )}
                        </td>
                        {isManager && selectedDoc.status === 'PENDING_APPROVAL' && (
                          <td style={{ textAlign: 'center' }}>
                            {isRejected ? (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                onClick={() => handleToggleRejectItem(item.id)}
                                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '700' }}
                                title="Batalkan penolakan item ini"
                              >
                                🔄 Restor Item
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-danger btn-sm"
                                onClick={() => handleToggleRejectItem(item.id)}
                                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '700' }}
                                title="Reject hanya item ini"
                              >
                                ❌ Reject Item
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--table-header-bg)', fontWeight: '800' }}>
                    <td colSpan={5} style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: '10.5px', padding: '7px 10px', color: 'var(--text-heading)' }}>
                      TOTAL (DISETUJUI):
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '800', color: 'var(--text-heading)', fontSize: '11.5px' }}>
                      {totalQty.toLocaleString()} PCS
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '800', color: 'var(--text-heading)', fontSize: '11.5px' }}>
                      Rp {totalUnitCostSum.toLocaleString('id-ID')}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '800', color: 'var(--success)', fontSize: '11.5px' }}>
                      Rp {totalPrice.toLocaleString('id-ID')}
                    </td>
                    <td style={{ textAlign: 'center' }}>-</td>
                    {isManager && selectedDoc.status === 'PENDING_APPROVAL' && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn-secondary btn-sm"
                onClick={() => setSelectedDoc(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '700', padding: '6px 14px', borderRadius: '5px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_back</span>
                Kembali ke Daftar PO Tracker
              </button>

              {isManager && selectedDoc.status === 'PENDING_APPROVAL' && (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn-danger btn-sm" onClick={() => handleReject(selectedDoc.id)} style={{ padding: '6px 14px', fontWeight: '700' }}>
                    <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '4px', fontSize: '16px' }}>cancel</span> Reject Seluruh PO
                  </button>
                  <button className="btn-success btn-sm" onClick={() => handleApprove(selectedDoc.id)} style={{ padding: '6px 14px', fontWeight: '700' }}>
                    <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '4px', fontSize: '16px' }}>check_circle</span> Approve PO (Item Disetujui)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isCreating) {
    const totalQty = lineItems.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
    const totalPrice = lineItems.reduce((acc, item) => acc + ((Number(item.quantity) || 0) * (Number(item.price) || 0)), 0);

    return (
      <div className="stockflow-screen-wrapper">
        {/* StockFlow Screen Title Bar with Back Button */}
        <div className="stockflow-title-bar">
          <div className="stockflow-title-left" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              className="btn-secondary"
              onClick={() => setIsCreating(false)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: '700', padding: '8px 16px', borderRadius: '6px' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span> Kembali ke Daftar PO Tracker
            </button>
            <div>
              <span className="screen-category">Procurement / Purchase Request & Operational PO</span>
              <h1 className="screen-main-title">Input Request Permintaan Pembelian Barang (PO): {form.doc_number}</h1>
            </div>
          </div>
        </div>

        {/* Header Form Card */}
        <div className="stockflow-form-3col">
          <div className="stockflow-form-col">
            <div className="stockflow-form-row">
              <label>Tipe Permintaan Pembelian:</label>
              <select
                value={form.doc_type}
                onChange={e => {
                  const newType = e.target.value;
                  setForm(f => ({
                    ...f,
                    doc_type: newType,
                    doc_number: generateDocNumber(newType)
                  }));
                }}
              >
                <option value="PO_PRODUCT">PO Pembelian Produk Master Catalog (Supplier)</option>
                <option value="PO_OPERATIONAL">PO Pembelian Barang Operasional / Perlengkapan Gudang</option>
              </select>
            </div>
            <div className="stockflow-form-row">
              <label>No. Purchase Order (PO):</label>
              <input
                type="text"
                value={form.doc_number}
                readOnly
                title="No. PO otomatis dibuat oleh sistem"
                style={{
                  fontWeight: '800',
                  color: 'var(--primary)',
                  fontFamily: 'JetBrains Mono, monospace',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-glow)',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  letterSpacing: '0.5px'
                }}
              />
            </div>
            <div className="stockflow-form-row">
              <label>Status Dokumen PO:</label>
              <span className="status-pill pill-pending_approval" style={{ fontSize: '10px', padding: '2px 8px' }}>PENDING MANAGER APPROVAL</span>
            </div>
          </div>

          <div className="stockflow-form-col">
            <div className="stockflow-form-row">
              <label>Gudang Tujuan Penerimaan:</label>
              <select
                value={form.warehouse_id}
                onChange={e => setForm({ ...form, warehouse_id: e.target.value })}
                disabled={user.role !== 'SUPER_ADMIN'}
              >
                {(data.wh || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.city})</option>)}
              </select>
            </div>
            <div className="stockflow-form-row">
              <label>Target Manager / Finance Approval:</label>
              <select value={form.assigned_manager_id} onChange={e => setForm({ ...form, assigned_manager_id: e.target.value })}>
                {(data.managers || []).map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
              </select>
            </div>
            <div className="stockflow-form-row">
              <label>Vendor / Supplier (Penyedia Barang):</label>
              <input type="text" value={form.partner} onChange={e => setForm({ ...form, partner: e.target.value })} placeholder="e.g. PT Supplier Utama Indonesia" />
            </div>
          </div>

          <div className="stockflow-totals-col">
            <div className="stockflow-total-row">
              <span>Total Item Baris:</span>
              <strong>{lineItems.length} Baris</strong>
            </div>
            <div className="stockflow-total-row">
              <span>Total Qty Barang:</span>
              <strong style={{ color: 'var(--primary)' }}>{totalQty.toLocaleString()} PCS</strong>
            </div>
            <div className="stockflow-total-row">
              <span>Total Est. Nilai (Rp):</span>
              <strong style={{ color: 'var(--success)' }}>Rp {totalPrice.toLocaleString('id-ID')}</strong>
            </div>
          </div>
        </div>

        {/* Multi-Line Item Entry Table */}
        <div className="stockflow-tab-wrapper" style={{ marginTop: '16px' }}>
          <div className="stockflow-tab-header">
            <button className="stockflow-tab-btn active">
              <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '6px' }}>shopping_cart</span>
              DETAIL BARANG PEMBELIAN / PURCHASE ORDER (AUTOFILL MASTER CATALOG)
            </button>
          </div>

          <div className="stockflow-tab-content" style={{ padding: '12px' }}>
            <div className="table-responsive">
              <table className="excel-data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                    <th style={{ minWidth: '240px' }}>Pilih SKU / Barcode (Master Catalog)</th>
                    <th>Nama Produk (Autofill)</th>
                    <th>Varian</th>
                    <th>Merk / Brand</th>
                    <th>Satuan</th>
                    <th style={{ width: '120px' }}>Jumlah (Qty)</th>
                    <th style={{ width: '140px' }}>Harga Beli / Est. Unit Cost (Rp)</th>
                    <th style={{ width: '150px' }}>Subtotal (Rp)</th>
                    <th style={{ width: '60px', textAlign: 'center' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan="10" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '32px', display: 'block', marginBottom: '8px', color: 'var(--primary)' }}>add_shopping_cart</span>
                        Belum ada barang dalam Purchase Order ini. Klik tombol <b>"+ Tambah Baris Barang"</b> di bawah untuk memasukkan produk pembelian.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item, idx) => {
                      const subtotal = (Number(item.quantity) || 0) * (Number(item.price) || 0);
                      return (
                        <tr key={idx}>
                          <td className="row-number" style={{ textAlign: 'center' }}>{idx + 1}</td>
                          <td>
                            <select
                              id={`sku-select-${idx}`}
                              value={item.product_id}
                              onChange={e => handleSelectProductInRow(idx, e.target.value)}
                              onKeyDown={e => handleKeyDownSku(e, idx)}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: 'var(--input-bg)',
                                color: item.product_id ? 'var(--primary)' : 'var(--text-muted)',
                                fontWeight: '800',
                                border: '1px solid var(--border-color)'
                              }}
                            >
                              <option value="">-- Pilih SKU / Barcode Produk --</option>
                              {(data.products || []).map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} {p.barcode ? `(${p.barcode})` : ''} - {p.product_name} {p.variant ? `[${p.variant}]` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td><b style={{ color: 'var(--text-heading)' }}>{item.product_name || '-'}</b></td>
                          <td>
                            <span className="badge-pro" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                              {item.variant || '-'}
                            </span>
                          </td>
                          <td>{item.brand || '-'}</td>
                          <td>{item.unit || '-'}</td>
                          <td>
                            <input
                              id={`qty-input-${idx}`}
                              type="number"
                              value={item.quantity}
                              onChange={e => handleUpdateLineItem(idx, 'quantity', e.target.value === '' ? '' : +e.target.value)}
                              onKeyDown={e => handleKeyDownQty(e, idx)}
                              placeholder="0"
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: 'var(--input-bg)',
                                color: 'var(--text-heading)',
                                fontWeight: '700',
                                textAlign: 'right',
                                border: '1px solid var(--border-color)'
                              }}
                            />
                          </td>
                          <td>
                            <input
                              id={`price-input-${idx}`}
                              type="number"
                              value={item.price}
                              onChange={e => handleUpdateLineItem(idx, 'price', e.target.value === '' ? '' : +e.target.value)}
                              onKeyDown={e => handleKeyDownPrice(e, idx)}
                              placeholder="0"
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: 'var(--input-bg)',
                                color: 'var(--success)',
                                fontWeight: '700',
                                textAlign: 'right',
                                border: '1px solid var(--border-color)'
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: '800', color: 'var(--success)' }}>
                            Rp {subtotal.toLocaleString('id-ID')}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="grid-action-btn"
                              onClick={() => handleRemoveLineRow(idx)}
                              title="Hapus baris ini"
                              style={{ color: 'var(--danger)', cursor: 'pointer' }}
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" className="btn-secondary" onClick={handleAddLineRow}>
                <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '4px' }}>add</span>
                + Tambah Baris Barang
              </button>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsCreating(false)}>
                  Batal
                </button>
                <button type="button" className="btn-release" onClick={handleCreate}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>send</span>
                  SUBMIT PURCHASE ORDER (PO) TO MANAGER
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* StockFlow Screen Category & Main Title */}
      <div className="stockflow-title-bar">
        <div className="stockflow-title-left">
          <span className="screen-category">Procurement & Purchase Request Management</span>
          <h1 className="screen-main-title">Purchase Order (PO) & Permintaan Pembelian Tracker</h1>
        </div>
      </div>

      {/* StockFlow Primary Action Toolbar */}
      <div className="stockflow-screen-toolbar">
        <div className="stockflow-toolbar-left">
          <button className="stockflow-tool-btn" onClick={startCreateNewDoc} title="Buat Dokumen Transaksi Baru (+)">
            <span className="material-symbols-outlined">add_box</span>
          </button>
          <button className="stockflow-tool-btn" onClick={reload} title="Reload Data Tracker">
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>
      </div>

      {/* StockFlow Screen Tabs Bar */}
      <div className="stockflow-tabs-bar">
        {['ALL DOCUMENTS', 'PENDING MANAGER', 'IN TRANSIT', 'APPROVED', 'REJECTED'].map(tab => (
          <button
            key={tab}
            className={`stockflow-tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Documents Progress Tracking List */}
      <div className="page-view-full" style={{ marginTop: '16px' }}>
        <div className="page-header-bar">
          <h2><span className="material-symbols-outlined">receipt_long</span> Purchase Order (PO) & Approval Tracker</h2>
        </div>
        <DataTable
          rows={filteredDocs}
          title="purchase_order_documents_approval"
          columns={[
            {
              key: 'doc_number',
              title: 'PO Number',
              render: row => (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setSelectedDoc(row)}
                  style={{
                    fontWeight: '800',
                    color: 'var(--primary)',
                    fontFamily: 'JetBrains Mono, monospace',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: '11px',
                    textDecoration: 'underline',
                    cursor: 'pointer'
                  }}
                  title="Klik untuk melihat detail & review item PO"
                >
                  {row.doc_number}
                </button>
              )
            },
            {
              key: 'doc_type',
              title: 'PO Type',
              render: row => {
                const displayType = row.doc_type === 'PO_PRODUCT' ? 'PO PRODUCT' :
                  (row.doc_type === 'PO_OPERATIONAL' ? 'PO OPERATIONAL' :
                  (row.doc_type === 'INBOUND' ? 'PURCHASE ORDER (PO)' : row.doc_type));
                return (
                  <span className="badge-pro" style={{ background: 'var(--primary-glow)', color: 'var(--primary)', fontWeight: '800', fontSize: '10px', padding: '2px 6px' }}>
                    {displayType}
                  </span>
                );
              }
            },
            { key: 'warehouse', title: 'Target Warehouse' },
            { key: 'partner', title: 'Vendor / Supplier' },
            { key: 'creator_name', title: 'Requested By' },
            { key: 'assigned_manager_name', title: 'Assigned Manager' },
            {
              key: 'status',
              title: 'Current Stage',
              render: row => (
                <span className={`status-pill pill-${row.status.toLowerCase()}`}>
                  {row.status === 'PENDING_APPROVAL' ? '⏳ PENDING' : row.status}
                </span>
              )
            },
            {
              key: 'created_at',
              title: 'Submitted Date',
              render: row => (
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-sub)' }}>
                  {row.created_at ? row.created_at.replace('T', ' ').slice(0, 16) : '-'}
                </span>
              )
            }
          ]}
          action={row => (
            <div className="action-button-group">
              <button className="btn-secondary btn-sm" onClick={() => setSelectedDoc(row)}>
                <span className="material-symbols-outlined">search</span> Track
              </button>

              {isManager && row.status === 'PENDING_APPROVAL' && (
                <>
                  <button className="btn-success btn-sm" onClick={() => handleApprove(row.id)}>
                    <span className="material-symbols-outlined">check_circle</span> Approve
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => handleReject(row.id)}>
                    <span className="material-symbols-outlined">cancel</span> Reject
                  </button>
                </>
              )}

              {row.doc_type === 'TRANSFER' && row.status === 'IN_TRANSIT' && (
                <button className="btn-primary btn-sm" onClick={() => handleReceive(row.id)}>
                  <span className="material-symbols-outlined">move_to_inbox</span> Receive
                </button>
              )}
            </div>
          )}
        />
      </div>
    </>
  );
}

function StockOpnameView({ data, reload, user }) {
  const [form, setForm] = useState({
    warehouse_id: String(user.warehouse_id || '1'),
    product_id: '1',
    actual_qty: 1000,
    note: 'Routine Inventory Audit'
  });

  const isManager = ['SUPER_ADMIN', 'MANAGER'].includes(user.role);

  useEffect(() => {
    if (user.warehouse_id && user.role !== 'SUPER_ADMIN') {
      setForm(f => ({ ...f, warehouse_id: String(user.warehouse_id) }));
    }
  }, [user]);

  async function handleCreateOpname() {
    try {
      await apiCall('/stock-opname', {
        method: 'POST',
        body: JSON.stringify({
          warehouse_id: +form.warehouse_id,
          product_id: +form.product_id,
          actual_qty: +form.actual_qty,
          note: form.note
        })
      });
      showToast('Stock Opname audit submitted successfully!', 'success');
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleAdjust(id) {
    try {
      await apiCall(`/stock-opname/${id}/adjust`, { method: 'POST' });
      showToast('Opname adjustment approved and inventory updated!', 'success');
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <>
      <div className="stockflow-form-panel">
        <div className="stockflow-form-header">
          <h3><span className="material-symbols-outlined">fact_check</span> Record Physical Stock Opname Audit</h3>
        </div>
        <div className="stockflow-form-grid">
          <div className="stockflow-form-row">
            <label>Target Warehouse:</label>
            <select
              value={form.warehouse_id}
              onChange={e => setForm({ ...form, warehouse_id: e.target.value })}
              disabled={user.role !== 'SUPER_ADMIN'}
            >
              {(data.wh || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          <div className="stockflow-form-row">
            <label>Product Item:</label>
            <select value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })}>
              {(data.products || []).map(p => <option key={p.id} value={p.id}>{p.sku} - {p.product_name}</option>)}
            </select>
          </div>

          <div className="stockflow-form-row">
            <label>Actual Count Qty:</label>
            <input
              type="number"
              value={form.actual_qty}
              onChange={e => setForm({ ...form, actual_qty: e.target.value })}
              placeholder="Actual Count"
            />
          </div>

          <div className="stockflow-form-row">
            <label>Audit Note:</label>
            <input
              type="text"
              value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="Audit Note"
            />
          </div>
        </div>

        <div className="stockflow-form-footer">
          <button className="btn-primary" onClick={handleCreateOpname}>
            <span className="material-symbols-outlined">fact_check</span> Submit Audit Count
          </button>
        </div>
      </div>

      <div className="page-view-full" style={{ marginTop: '16px' }}>
        <div className="page-header-bar">
          <h2><span className="material-symbols-outlined">fact_check</span> Stock Opname Records & Variance Approval</h2>
        </div>
        <DataTable
          rows={data.opname || []}
          columns={[
            { key: 'id', title: 'ID' },
            { key: 'warehouse', title: 'Warehouse' },
            { key: 'sku', title: 'SKU' },
            { key: 'product_name', title: 'Product' },
            { key: 'system_qty', title: 'System Qty' },
            { key: 'actual_qty', title: 'Actual Qty' },
            {
              key: 'variance',
              title: 'Variance',
              render: row => (
                <b className={row.variance > 0 ? 'text-success' : (row.variance < 0 ? 'text-danger' : '')}>
                  {row.variance > 0 ? `+${row.variance}` : row.variance}
                </b>
              )
            },
            {
              key: 'status',
              title: 'Status',
              render: row => <span className={`status-pill pill-${row.status.toLowerCase()}`}>{row.status}</span>
            },
            { key: 'note', title: 'Note' },
            { key: 'created_at', title: 'Date' }
          ]}
          action={row => (
            row.status === 'PENDING_APPROVAL' && isManager ? (
              <button className="btn-success btn-sm" onClick={() => handleAdjust(row.id)}>Approve Adjustment</button>
            ) : (
              <span className="text-muted">{row.status === 'APPROVED' ? 'Adjusted' : 'Pending Manager'}</span>
            )
          )}
        />
      </div>
    </>
  );
}

function WarehousesView({ data, reload, user }) {
  const [isAddingInline, setIsAddingInline] = useState(false);
  const [inlineForm, setInlineForm] = useState({
    name: '',
    city: '',
    address: '',
    status: 'ACTIVE'
  });

  const [editingWarehouse, setEditingWarehouse] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    city: '',
    address: '',
    status: 'ACTIVE'
  });

  const isSuperAdminOrManager = ['SUPER_ADMIN', 'MANAGER'].includes(user.role);

  async function handleSaveInlineWarehouse(e) {
    e?.preventDefault();
    if (!inlineForm.name?.trim() || !inlineForm.city?.trim() || !inlineForm.address?.trim()) {
      return showToast('Semua kolom gudang (Nama Gudang, Kota, Alamat) wajib diisi secara lengkap!', 'error');
    }
    try {
      await apiCall('/warehouses', {
        method: 'POST',
        body: JSON.stringify(inlineForm)
      });
      showToast(`Gudang "${inlineForm.name}" berhasil ditambahkan!`, 'success');
      setInlineForm({ name: '', city: '', address: '', status: 'ACTIVE' });
      setIsAddingInline(false);
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function openEditModal(targetWh) {
    setEditingWarehouse(targetWh);
    setEditForm({
      name: targetWh.name || '',
      city: targetWh.city || '',
      address: targetWh.address || '',
      status: targetWh.status || 'ACTIVE'
    });
  }

  async function handleUpdateWarehouse(e) {
    e?.preventDefault();
    if (!editingWarehouse) return;
    try {
      await apiCall(`/warehouses/${editingWarehouse.id}`, {
        method: 'PUT',
        body: JSON.stringify(editForm)
      });
      showToast(`Gudang "${editForm.name}" berhasil diperbarui!`, 'success');
      setEditingWarehouse(null);
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDeleteWarehouse(targetWh) {
    if (!confirm(`Apakah Anda yakin ingin menghapus Gudang "${targetWh.name}"?`)) return;
    try {
      await apiCall(`/warehouses/${targetWh.id}`, { method: 'DELETE' });
      showToast(`Gudang "${targetWh.name}" berhasil dihapus.`, 'success');
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const inlineTopRow = isAddingInline ? (
    <tr className="excel-inline-edit-row">
      <td style={{ textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>*</td>
      <td style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '10.5px' }}>NEW</td>
      <td>
        <input
          type="text"
          className="excel-grid-input"
          placeholder="Warehouse Name (e.g. Jakarta DC)"
          value={inlineForm.name}
          onChange={e => setInlineForm({ ...inlineForm, name: e.target.value })}
          autoFocus
        />
      </td>
      <td>
        <input
          type="text"
          className="excel-grid-input"
          placeholder="City / Region (e.g. Jakarta)"
          value={inlineForm.city}
          onChange={e => setInlineForm({ ...inlineForm, city: e.target.value })}
        />
      </td>
      <td>
        <input
          type="text"
          className="excel-grid-input"
          placeholder="Full Address (e.g. Jl. Raya Industri No. 12)"
          value={inlineForm.address}
          onChange={e => setInlineForm({ ...inlineForm, address: e.target.value })}
        />
      </td>
      <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>0</td>
      <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>0</td>
      <td>
        <select
          className="excel-grid-select"
          value={inlineForm.status}
          onChange={e => setInlineForm({ ...inlineForm, status: e.target.value })}
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>
      </td>
      <td>
        <div className="action-button-group">
          <button
            type="button"
            className="btn-success btn-sm"
            onClick={handleSaveInlineWarehouse}
            title="Simpan Gudang Baru"
            style={{ padding: '3px 10px', fontWeight: 'bold' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span> Simpan
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setIsAddingInline(false);
              setInlineForm({ name: '', city: '', address: '', status: 'ACTIVE' });
            }}
            title="Batal"
            style={{ padding: '3px 8px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span> Batal
          </button>
        </div>
      </td>
    </tr>
  ) : null;

  return (
    <>
      <div className="page-view-full">
        <div className="page-header-bar">
          <h2><span className="material-symbols-outlined">domain</span> Multi-Warehouse Management & Locations</h2>
        </div>

        <DataTable
          onAdd={isSuperAdminOrManager ? () => setIsAddingInline(true) : null}
          topRow={inlineTopRow}
          rows={data.warehouses || []}
          columns={[
            { key: 'id', title: 'ID' },
            {
              key: 'name',
              title: 'Warehouse Name',
              render: row => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>warehouse</span>
                  {row.name}
                </div>
              )
            },
            { key: 'city', title: 'City / Region' },
            { key: 'address', title: 'Address' },
            {
              key: 'total_stock',
              title: 'Total Stock On Hand',
              render: row => (
                <strong className="text-success" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {row.total_stock?.toLocaleString() || 0}
                </strong>
              )
            },
            { key: 'total_skus', title: 'SKUs Monitored' },
            {
              key: 'status',
              title: 'Status',
              render: row => <span className={`status-pill pill-${row.status.toLowerCase()}`}>{row.status}</span>
            }
          ]}
          action={row => (
            <div className="action-button-group">
              {isSuperAdminOrManager && (
                <button className="btn-secondary btn-sm" onClick={() => openEditModal(row)}>
                  <span className="material-symbols-outlined">edit_note</span> Edit
                </button>
              )}
              {user.role === 'SUPER_ADMIN' && (
                <button className="btn-danger btn-sm" onClick={() => handleDeleteWarehouse(row)}>
                  <span className="material-symbols-outlined">delete_forever</span> Hapus
                </button>
              )}
            </div>
          )}
        />
      </div>

      {/* Modal Edit Warehouse */}
      {editingWarehouse && (
        <div className="modal-backdrop" onClick={() => setEditingWarehouse(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <h3><span className="material-symbols-outlined">edit_note</span> EDIT WAREHOUSE: {editingWarehouse.name}</h3>
              <button className="modal-close" onClick={() => setEditingWarehouse(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleUpdateWarehouse}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group">
                  <label>Warehouse Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>City / Region</label>
                  <input
                    type="text"
                    value={editForm.city}
                    onChange={e => setEditForm({ ...editForm, city: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Full Address</label>
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={e => setEditForm({ ...editForm, address: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Status</label>
                  <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button type="submit" className="btn-success">
                  <span className="material-symbols-outlined">save</span> Simpan Perubahan
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditingWarehouse(null)}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function UsersView({ data, reload, user }) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const canManageUsers = ['SUPER_ADMIN', 'MANAGER'].includes(user.role);

  const [isAddingInline, setIsAddingInline] = useState(false);
  const [inlineForm, setInlineForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'WAREHOUSE_ADMIN',
    warehouse_id: '1'
  });

  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'WAREHOUSE_ADMIN',
    warehouse_id: '1',
    status: 'ACTIVE'
  });

  async function handleSaveInlineUser(e) {
    e?.preventDefault();
    if (!inlineForm.name?.trim() || !inlineForm.email?.trim() || !inlineForm.password?.trim()) {
      return showToast('Mohon isi Nama Lengkap, Email, dan Password user baru secara lengkap!', 'error');
    }
    try {
      await apiCall('/users', {
        method: 'POST',
        body: JSON.stringify({
          name: inlineForm.name,
          email: inlineForm.email,
          password: inlineForm.password,
          role: inlineForm.role,
          warehouse_id: inlineForm.role === 'SUPER_ADMIN' ? null : +inlineForm.warehouse_id
        })
      });
      showToast(`Akun user ${inlineForm.email} berhasil dibuat!`, 'success');
      setInlineForm({ name: '', email: '', password: '', role: 'WAREHOUSE_ADMIN', warehouse_id: '1' });
      setIsAddingInline(false);
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function startEditRow(targetUser) {
    setEditingUser(targetUser);
    setEditForm({
      name: targetUser.name || '',
      email: targetUser.email || '',
      password: '',
      role: targetUser.role || 'WAREHOUSE_ADMIN',
      warehouse_id: String(targetUser.warehouse_id || '1'),
      status: targetUser.status || 'ACTIVE'
    });
  }

  async function handleUpdateUser(e) {
    e?.preventDefault();
    if (!editingUser) return;
    if (!editForm.name?.trim() || !editForm.email?.trim()) {
      return showToast('Nama Lengkap dan Email user tidak boleh kosong!', 'error');
    }
    try {
      await apiCall(`/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name,
          email: editForm.email,
          password: editForm.password || undefined,
          role: editForm.role,
          warehouse_id: editForm.role === 'SUPER_ADMIN' ? null : +editForm.warehouse_id,
          status: editForm.status
        })
      });
      showToast(`User ${editForm.email} berhasil diperbarui!`, 'success');
      setEditingUser(null);
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDeleteUser(targetUser) {
    if (user.id === targetUser.id) {
      return showToast('Anda tidak dapat menghapus akun Anda sendiri!', 'error');
    }
    if (!confirm(`Are you sure you want to delete user "${targetUser.name}" (${targetUser.email})?`)) return;
    try {
      await apiCall(`/users/${targetUser.id}`, { method: 'DELETE' });
      showToast(`User ${targetUser.email} berhasil dihapus.`, 'success');
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleToggleUserStatus(targetUser) {
    if (user.id === targetUser.id) {
      return showToast('Anda tidak dapat menonaktifkan akun Anda sendiri.', 'error');
    }
    const newStatus = targetUser.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    try {
      await apiCall(`/users/${targetUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      showToast(`Status akun ${targetUser.email} diubah menjadi ${newStatus}.`, 'success');
      reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const inlineTopRow = isAddingInline ? (
    <tr className="excel-inline-edit-row">
      <td style={{ textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>*</td>
      <td style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '10.5px' }}>NEW</td>
      <td>
        <input
          type="text"
          className="excel-grid-input"
          placeholder="Full Name (e.g. Budi)"
          value={inlineForm.name}
          onChange={e => setInlineForm({ ...inlineForm, name: e.target.value })}
          autoFocus
        />
      </td>
      <td>
        <input
          type="email"
          className="excel-grid-input"
          placeholder="email@stockflow.local"
          value={inlineForm.email}
          onChange={e => setInlineForm({ ...inlineForm, email: e.target.value })}
        />
      </td>
      <td>
        <input
          type="password"
          className="excel-grid-input"
          placeholder="Password"
          value={inlineForm.password}
          onChange={e => setInlineForm({ ...inlineForm, password: e.target.value })}
        />
      </td>
      <td>
        <select
          className="excel-grid-select"
          value={inlineForm.role}
          onChange={e => setInlineForm({ ...inlineForm, role: e.target.value })}
        >
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          <option value="MANAGER">MANAGER</option>
          <option value="WAREHOUSE_ADMIN">WAREHOUSE_ADMIN</option>
          <option value="OPERATOR">OPERATOR</option>
          <option value="VIEWER">VIEWER</option>
        </select>
      </td>
      <td>
        {inlineForm.role === 'SUPER_ADMIN' ? (
          <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: '600' }}>
            🌐 All Warehouses (Global)
          </span>
        ) : (
          <select
            className="excel-grid-select"
            value={inlineForm.warehouse_id}
            onChange={e => setInlineForm({ ...inlineForm, warehouse_id: e.target.value })}
          >
            {(data.wh || []).map(w => (
              <option key={w.id} value={w.id}>{w.name} ({w.city})</option>
            ))}
          </select>
        )}
      </td>
      <td>
        <span className="status-pill pill-approved" style={{ fontSize: '10px', padding: '2px 8px' }}>
          ✅ ACTIVE
        </span>
      </td>
      <td style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Auto (Now)</td>
      <td>
        <div className="action-button-group">
          <button
            type="button"
            className="btn-success btn-sm"
            onClick={handleSaveInlineUser}
            title="Simpan User Baru"
            style={{ padding: '3px 10px', fontWeight: 'bold' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span> Simpan
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setIsAddingInline(false);
              setInlineForm({ name: '', email: '', password: '', role: 'WAREHOUSE_ADMIN', warehouse_id: '1' });
            }}
            title="Batal"
            style={{ padding: '3px 8px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span> Batal
          </button>
        </div>
      </td>
    </tr>
  ) : null;

  return (
    <>
      <div className="page-view-full">
        <div className="page-header-bar">
          <h2><span className="material-symbols-outlined">group</span> System User & Role Management</h2>
        </div>

        <DataTable
          onAdd={canManageUsers ? () => setIsAddingInline(true) : null}
          topRow={inlineTopRow}
          rows={data.users || []}
          columns={[
            { key: 'id', title: 'ID' },
            {
              key: 'name',
              title: 'User Name',
              render: row => {
                if (editingUser?.id === row.id) {
                  return (
                    <input
                      type="text"
                      className="excel-grid-input"
                      value={editForm.name}
                      onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      autoFocus
                    />
                  );
                }
                return row.name;
              }
            },
            {
              key: 'email',
              title: 'Email',
              render: row => {
                if (editingUser?.id === row.id) {
                  return (
                    <input
                      type="email"
                      className="excel-grid-input"
                      value={editForm.email}
                      onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                    />
                  );
                }
                return row.email;
              }
            },
            {
              key: 'password',
              title: 'Password',
              render: row => {
                if (editingUser?.id === row.id) {
                  return (
                    <input
                      type="password"
                      className="excel-grid-input"
                      placeholder="Reset Pass..."
                      value={editForm.password}
                      onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                    />
                  );
                }
                return (
                  <span style={{ letterSpacing: '2px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '13px' }}>
                    ••••••••
                  </span>
                );
              }
            },
            {
              key: 'role',
              title: 'Role',
              render: row => {
                if (editingUser?.id === row.id && isSuperAdmin) {
                  return (
                    <select
                      className="excel-grid-select"
                      value={editForm.role}
                      onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                    >
                      <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="WAREHOUSE_ADMIN">WAREHOUSE_ADMIN</option>
                      <option value="OPERATOR">OPERATOR</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  );
                }
                return row.role;
              }
            },
            {
              key: 'warehouse_id',
              title: 'Assigned Warehouse',
              getFilterValue: row => {
                if (row.role === 'SUPER_ADMIN') return 'All Warehouses (Global)';
                const wh = (data.wh || []).find(w => w.id === row.warehouse_id);
                return wh ? wh.name : (row.warehouse_id ? `Gudang ID: ${row.warehouse_id}` : '-');
              },
              render: row => {
                const wh = (data.wh || []).find(w => w.id === row.warehouse_id);
                if (editingUser?.id === row.id && isSuperAdmin) {
                  if (editForm.role === 'SUPER_ADMIN') {
                    return (
                      <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: '600' }}>
                        🌐 All Warehouses (Global)
                      </span>
                    );
                  }
                  return (
                    <select
                      className="excel-grid-select"
                      value={editForm.warehouse_id}
                      onChange={e => setEditForm({ ...editForm, warehouse_id: e.target.value })}
                    >
                      {(data.wh || []).map(w => (
                        <option key={w.id} value={w.id}>{w.name} ({w.city})</option>
                      ))}
                    </select>
                  );
                }
                return row.role === 'SUPER_ADMIN' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--primary)' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>language</span> All Warehouses (Global)
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--primary)' }}>location_on</span> {wh ? wh.name : `Gudang ID: ${row.warehouse_id || '-'}`}
                  </span>
                );
              }
            },
            {
              key: 'status',
              title: 'Status',
              render: row => {
                if (editingUser?.id === row.id && isSuperAdmin) {
                  return (
                    <select
                      className="excel-grid-select"
                      value={editForm.status}
                      onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                    </select>
                  );
                }
                return (
                  <span className={`status-pill ${row.status === 'INACTIVE' ? 'pill-rejected' : 'pill-approved'}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
                    {row.status === 'INACTIVE' ? '❌ INACTIVE' : '✅ ACTIVE'}
                  </span>
                );
              }
            },
            { key: 'created_at', title: 'Created Date' }
          ]}
          action={row => {
            if (editingUser?.id === row.id) {
              return (
                <div className="action-button-group" style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn-success btn-sm"
                    onClick={handleUpdateUser}
                    title="Simpan Perubahan User"
                    style={{ padding: '3px 10px', fontWeight: 'bold' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span> Simpan
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setEditingUser(null)}
                    title="Batal Edit"
                    style={{ padding: '3px 8px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span> Batal
                  </button>
                </div>
              );
            }

            return (
              <div className="action-button-group" style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => startEditRow(row)}
                  title="Edit User / Reset Password Inline"
                  style={{ padding: '4px 8px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit_note</span>
                </button>
                {canManageUsers && user.id !== row.id && (
                  <>
                    <button
                      type="button"
                      className={row.status === 'INACTIVE' ? 'btn-success btn-sm' : 'btn-warning btn-sm'}
                      onClick={() => handleToggleUserStatus(row)}
                      title={row.status === 'INACTIVE' ? 'Aktifkan Akun User' : 'Non-aktifkan Akun User'}
                      style={{ padding: '4px 8px' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                        {row.status === 'INACTIVE' ? 'check_circle' : 'block'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => handleDeleteUser(row)}
                      title="Hapus Akun User"
                      style={{ padding: '4px 8px' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete_forever</span>
                    </button>
                  </>
                )}
              </div>
            );
          }}
        />
      </div>
    </>
  );
}

function DataTable({ rows = [], columns = [], action, title = 'export_data', onRefresh, onAdd, topRow }) {
  const [filterText, setFilterText] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  const [activeFilterCol, setActiveFilterCol] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [autoWidth, setAutoWidth] = useState(false);

  const getColValue = (row, col) => {
    if (!row || !col) return '';
    if (typeof col.getFilterValue === 'function') {
      return col.getFilterValue(row);
    }
    return row[col.key];
  };

  // Filter rows based on global search + column filters
  let filteredRows = rows.filter(row => {
    // 1. Global Filter
    if (filterText) {
      const searchStr = filterText.toLowerCase();
      const matchesGlobal = columns.some(col => {
        const val = getColValue(row, col);
        return val !== null && val !== undefined && String(val).toLowerCase().includes(searchStr);
      });
      if (!matchesGlobal) return false;
    }

    // 2. Column-Level Filters
    for (const colKey of Object.keys(columnFilters)) {
      const colSearch = columnFilters[colKey]?.toLowerCase();
      if (colSearch) {
        const colObj = columns.find(c => c.key === colKey);
        const val = colObj ? getColValue(row, colObj) : row[colKey];
        const valStr = val !== null && val !== undefined ? String(val).toLowerCase() : '';
        if (!valStr.includes(colSearch)) return false;
      }
    }

    return true;
  });

  // Sort rows if sortConfig is active
  if (sortConfig.key) {
    const colObj = columns.find(c => c.key === sortConfig.key);
    filteredRows = [...filteredRows].sort((a, b) => {
      let valA = colObj ? getColValue(a, colObj) : (a[sortConfig.key] ?? '');
      let valB = colObj ? getColValue(b, colObj) : (b[sortConfig.key] ?? '');
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      }
      return sortConfig.direction === 'asc'
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }

  function handleSort(key) {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  }

  function handleColumnFilterChange(key, val) {
    setColumnFilters(prev => ({ ...prev, [key]: val }));
  }

  function clearAllFilters() {
    setFilterText('');
    setColumnFilters({});
    setSortConfig({ key: null, direction: 'asc' });
    setActiveFilterCol(null);
  }

  function handleExportExcel() {
    if (!filteredRows.length) return showToast('Tidak ada data untuk di-export.', 'error');
    const headers = columns.map(c => `"${c.title}"`).join(',');
    const rowLines = filteredRows.map(row =>
      columns.map(c => {
        let val = getColValue(row, c);
        if (val === null || val === undefined) val = '';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers, ...rowLines].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${title}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const hasActiveFilters = filterText || Object.values(columnFilters).some(Boolean);

  return (
    <div className="excel-grid-container" onClick={() => setActiveFilterCol(null)}>
      <div className="excel-grid-toolbar" onClick={e => e.stopPropagation()}>
        {/* StockFlow Grid Action Buttons */}
        <div className="excel-grid-actions">
          {onAdd && (
            <button
              type="button"
              className="grid-action-btn"
              onClick={onAdd}
              title="Tambah Data / Baris Baru (+)"
            >
              <span className="material-symbols-outlined">add</span>
            </button>
          )}

          <button
            className="grid-action-btn"
            onClick={() => { clearAllFilters(); onRefresh?.(); }}
            title="Refresh Data Grid & Reset Filters (↻)"
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>

          <button
            className={`grid-action-btn ${autoWidth ? 'active' : ''}`}
            onClick={() => setAutoWidth(!autoWidth)}
            title="Toggle Auto-Fit Column Width (|⟷| Lebar Otomatis)"
          >
            <span className="material-symbols-outlined">unfold_more</span>
          </button>

          <button
            className="grid-action-btn btn-excel-export"
            onClick={handleExportExcel}
            title="Export to Excel Spreadsheet (.CSV)"
          >
            <span className="material-symbols-outlined">table_view</span>
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              className="grid-action-btn"
              onClick={clearAllFilters}
              title="Reset Semua Filter & Search"
              style={{
                color: '#dc2626',
                borderColor: '#fca5a5',
                background: '#fef2f2',
                padding: '0 8px',
                fontWeight: '600',
                fontSize: '11px',
                whiteSpace: 'nowrap'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '15px', marginRight: '3px' }}>filter_alt_off</span>
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        {/* Filter Search Box & Record Counter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="excel-grid-search">
            <span className="material-symbols-outlined">search</span>
            <input
              type="text"
              placeholder="Global grid search..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
            />
            {filterText && (
              <button className="excel-search-clear" onClick={() => setFilterText('')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            )}
          </div>
          <div className="excel-grid-stats">
            <span className="material-symbols-outlined">table_chart</span>
            <span><b>{filteredRows.length}</b> records</span>
          </div>
        </div>
      </div>

      <div className="table-responsive">
        <table className={`excel-data-table ${autoWidth ? 'auto-width-mode' : ''}`}>
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>#</th>
              {columns.map((col, colIdx) => {
                const isFiltered = Boolean(columnFilters[col.key]);
                const isSorted = sortConfig.key === col.key;
                const isMenuOpen = activeFilterCol === col.key;
                const isRightCol = colIdx >= columns.length - 2;
                const uniqueValues = Array.from(new Set(rows.map(r => getColValue(r, col)).filter(v => v !== null && v !== undefined && v !== ''))).slice(0, 15);

                return (
                  <th key={col.key} className="excel-th-sortable" style={{ position: 'relative', zIndex: isMenuOpen ? 9999 : 1 }}>
                    <div className="th-content" onClick={e => e.stopPropagation()}>
                      <span
                        className="th-title-text"
                        onClick={() => handleSort(col.key)}
                        title={`Click to sort by ${col.title}`}
                      >
                        {col.title}
                        {isSorted && (
                          <span className="material-symbols-outlined th-sort-icon">
                            {sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </span>

                      <button
                        type="button"
                        className={`th-filter-btn ${isFiltered ? 'active-filter' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFilterCol(isMenuOpen ? null : col.key);
                        }}
                        title={`Filter column: ${col.title}`}
                      >
                        <span className="material-symbols-outlined">
                          {isFiltered ? 'filter_alt' : 'arrow_drop_down'}
                        </span>
                      </button>
                    </div>

                    {/* StockFlow / Excel Column Filter Popover Menu */}
                    {isMenuOpen && (
                      <div className={`stockflow-col-popover ${isRightCol ? 'align-right' : ''}`} onClick={e => e.stopPropagation()}>
                        <div className="popover-header">
                          <span>Filter: {col.title}</span>
                          <button onClick={() => setActiveFilterCol(null)} className="popover-close">
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>

                        <div className="popover-sort-section">
                          <button
                            className={`popover-sort-btn ${isSorted && sortConfig.direction === 'asc' ? 'active' : ''}`}
                            onClick={() => { setSortConfig({ key: col.key, direction: 'asc' }); setActiveFilterCol(null); }}
                          >
                            <span className="material-symbols-outlined">arrow_upward</span> Sort A to Z
                          </button>
                          <button
                            className={`popover-sort-btn ${isSorted && sortConfig.direction === 'desc' ? 'active' : ''}`}
                            onClick={() => { setSortConfig({ key: col.key, direction: 'desc' }); setActiveFilterCol(null); }}
                          >
                            <span className="material-symbols-outlined">arrow_downward</span> Sort Z to A
                          </button>
                        </div>

                        <div className="popover-search-box">
                          <span className="material-symbols-outlined">search</span>
                          <input
                            type="text"
                            placeholder={`Search ${col.title}...`}
                            value={columnFilters[col.key] || ''}
                            onChange={e => handleColumnFilterChange(col.key, e.target.value)}
                            autoFocus
                          />
                        </div>

                        {uniqueValues.length > 0 && (
                          <div className="popover-quick-list">
                            <div className="quick-list-title">Quick Select Values:</div>
                            {uniqueValues.map((val, idx) => (
                              <div
                                key={idx}
                                className={`quick-item ${columnFilters[col.key] === String(val) ? 'selected' : ''}`}
                                onClick={() => {
                                  handleColumnFilterChange(col.key, columnFilters[col.key] === String(val) ? '' : String(val));
                                  setActiveFilterCol(null);
                                }}
                              >
                                <span className="material-symbols-outlined">
                                  {columnFilters[col.key] === String(val) ? 'check_box' : 'check_box_outline_blank'}
                                </span>
                                <span>{String(val)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="popover-footer">
                          {isFiltered && (
                            <button
                              className="btn-popover-clear"
                              onClick={() => { handleColumnFilterChange(col.key, ''); setActiveFilterCol(null); }}
                            >
                              Clear Filter
                            </button>
                          )}
                          <button className="btn-popover-apply" onClick={() => setActiveFilterCol(null)}>
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </th>
                );
              })}
              {action && <th style={{ textAlign: 'center' }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {topRow}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1 + (action ? 1 : 0)} className="text-center text-muted py-4">
                  No matching records found.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => (
                <tr key={row.id || index}>
                  <td className="row-number">{index + 1}</td>
                  {columns.map(col => (
                    <td key={col.key}>
                      {col.render ? col.render(row) : (row[col.key] ?? '-')}
                    </td>
                  ))}
                  {action && <td className="action-cell">{action(row)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="excel-grid-footer">
        <span>Ready</span>
        <span>Displaying {filteredRows.length} of {rows.length} Total Items</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
