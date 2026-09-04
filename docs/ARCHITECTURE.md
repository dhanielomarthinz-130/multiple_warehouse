# STOCKFLOW PRO - System Architecture & Tiered Manager Approval Flow

Dokumentasi arsitektur sistem, skema database, alur persetujuan berjenjang (Admin Request ➔ Manager Approval), pelacak progres visual (*stepper*), dan kontrol akses untuk **STOCKFLOW PRO - Multi-Warehouse Inventory Monitoring System**.

---

## 1. Topologi Arsitektur & Alur Persetujuan Berjenjang

Dalam arsitektur enterprise STOCKFLOW PRO, pembuatan dokumen transaksi diajukan oleh **Admin/Operator** dan dialokasikan untuk disetujui (*approval*) oleh **Manager** target. Admin dapat memantau pelacak alur progres (*Workflow Stepper*) secara real-time.

```
+-----------------------------------------------------------------------------------+
|                            WORKFLOW PROGRESS STEPPER                              |
|                                                                                   |
|  [ 1. DRAFT ] ──> [ 2. PENDING MANAGER ] ──> [ 3. APPROVED ] ──> [ 4. RECEIVED ]  |
|   Admin Buat       Diajukan ke Manager       Disetujui Manager     Barang Diterima |
+-----------------------------------------------------------------------------------+
```

---

## 2. Sequence Diagram: Alur Persetujuan Dokumen (Admin ➔ Manager)

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Admin / Operator
    actor Manager as Target Manager
    participant API as Express REST API
    participant DB as Database (SQLite/PostgreSQL)

    Admin->>API: POST /api/inbounds (Pilih Target Manager & Input Item)
    API->>DB: INSERT INTO documents (status: 'PENDING_APPROVAL', assigned_manager_id: :manager_id)
    DB-->>API: Document Created
    API-->>Admin: Status: PENDING_APPROVAL (Admin Memantau Progres)

    Note over Admin,Manager: Admin dapat melihat tracker: "Menunggu Persetujuan Manager [Nama Manager]"

    Manager->>API: GET /api/documents (Manager Melihat Daftar Pengajuan Ditugaskan)
    
    alt Manager Menyetujui (Approve)
        Manager->>API: POST /api/documents/:id/approve
        Note over API,DB: Transaksi Atomik (ACID)
        API->>DB: BEGIN TRANSACTION
        API->>DB: Update Stok Produk di Inventory
        API->>DB: Catat Mutasi Audit di stock_movements
        API->>DB: UPDATE documents SET status = 'APPROVED', approved_by = :manager_id
        API->>DB: COMMIT TRANSACTION
        API-->>Manager: Response: Approved Successfully
        API-->>Admin: Progres Ter-update: APPROVED (Stok Berhasil Diperbarui)
    else Manager Menolak (Reject)
        Manager->>API: POST /api/documents/:id/reject (dengan Rejection Reason)
        API->>DB: UPDATE documents SET status = 'REJECTED', rejection_reason = :reason
        API-->>Manager: Response: Document Rejected
        API-->>Admin: Progres Ter-update: REJECTED (Stok Tidak Berubah)
    end
```

---

## 3. Matriks Hak Akses (RBAC Permission Matrix)

| Fitur / Endpoint API | SUPER_ADMIN | MANAGER | WAREHOUSE_ADMIN | OPERATOR | VIEWER |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Dashboard & DOI Analytics** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Lihat Stok & Catalog Produk** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Buat Request Dokumen (Inbound/Outbound/Transfer)** | ✅ | ❌ | ✅ | ✅ | ❌ |
| **Pantau Progres Tracker Dokumen** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Approve / Reject Dokumen (Approval Wewenang)** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Input & Approve Stock Opname** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Kelola Master Gudang & Produk** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Kelola User & Role** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Audit Logs & Export CSV** | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 4. Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    users ||--o{ documents : "creates"
    users ||--o{ documents : "assigned_as_manager"
    users ||--o{ documents : "approves"
    warehouses ||--o{ inventory : "holds"
    products ||--o{ inventory : "stocked_as"
    documents ||--|{ document_items : "contains"

    documents {
        bigint id PK
        string doc_type
        string doc_number UK
        bigint warehouse_id FK
        bigint destination_warehouse_id FK
        string status
        bigint created_by FK
        bigint assigned_manager_id FK
        bigint approved_by FK
        text rejection_reason
    }
```
