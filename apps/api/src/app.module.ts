import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { DocumentQueue, documentStorageProvider } from './common/documents/documents';
import { PrismaModule } from './common/prisma/prisma.module';
import { AiLogsController, AiLogsService, AiSettingsController } from './modules/ai-logs/ai-logs';
import { AuditLogsController, AuditLogsService } from './modules/audit-logs/audit-logs';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CategoriesController, CategoriesService } from './modules/categories/categories';
import { ContractorsController } from './modules/contractors/contractors.controller';
import { ContractorsService } from './modules/contractors/contractors.service';
import { DashboardController, DashboardService } from './modules/dashboard/dashboard';
import { HealthModule } from './modules/health/health.module';
import { InventoryController } from './modules/inventory/inventory.controller';
import { InventoryService } from './modules/inventory/inventory.service';
import { InvoiceReceiptService } from './modules/inventory/invoice-receipt.service';
import { InvoicesController } from './modules/invoices/invoices.controller';
import { InvoicesService } from './modules/invoices/invoices.service';
import { LocationsController, LocationsService } from './modules/locations/locations';
import { MaterialsController } from './modules/materials/materials.controller';
import { MaterialsService } from './modules/materials/materials.service';
import { ProjectsController, ProjectsService } from './modules/projects/projects';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { StockController } from './modules/stock/stock.controller';
import { StockService } from './modules/stock/stock.service';
import { StoresController, StoresService } from './modules/stores/stores';
import {
  SupplierMappingsController,
  SuppliersController,
  SuppliersService,
} from './modules/suppliers/suppliers';
import { TransactionsController } from './modules/transactions/transactions.controller';
import { TransactionsService } from './modules/transactions/transactions.service';
import { UnitsController, UnitsService } from './modules/units/units';
import { UsersController, UsersService } from './modules/users/users';
import { VerificationController } from './modules/verification/verification.controller';
import { VerificationService } from './modules/verification/verification.service';

@Module({
  imports: [PrismaModule, CommonModule, HealthModule],
  controllers: [
    AuthController,
    ProjectsController,
    StoresController,
    LocationsController,
    CategoriesController,
    UnitsController,
    MaterialsController,
    UsersController,
    AuditLogsController,
    DashboardController,
    InventoryController,
    StockController,
    VerificationController,
    TransactionsController,
    ContractorsController,
    SuppliersController,
    SupplierMappingsController,
    InvoicesController,
    AiLogsController,
    AiSettingsController,
    ReportsController,
  ],
  providers: [
    AuthService,
    ProjectsService,
    StoresService,
    LocationsService,
    CategoriesService,
    UnitsService,
    MaterialsService,
    UsersService,
    AuditLogsService,
    DashboardService,
    InventoryService,
    StockService,
    VerificationService,
    TransactionsService,
    ContractorsService,
    SuppliersService,
    InvoiceReceiptService,
    InvoicesService,
    AiLogsService,
    ReportsService,
    DocumentQueue,
    documentStorageProvider,
  ],
})
export class AppModule {}
