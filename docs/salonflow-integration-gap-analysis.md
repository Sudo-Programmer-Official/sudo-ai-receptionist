# SalonFlow Integration Gap Analysis

Scope: inspect the existing SalonFlow codebase at `/Users/abhishekkumarjha/Documents/salon-flow` without modifying it, and identify the current code paths relevant to a scoped external receptionist integration.

## Summary

SalonFlow already has most of the domain capability needed for a receptionist integration, but it is exposed through internal, tenant-scoped, owner/staff/admin routes rather than a narrow external API. The main gap is not domain logic. It is the lack of a dedicated integration surface with scoped auth, stable DTOs, idempotency guarantees, and tenant resolution that does not depend on browser/session behavior.

## Capability Map

| Capability | Existing location(s) | Assessment | Notes |
|---|---|---|---|
| Business profile | `apps/salonflow-api/src/modules/settings/settings.routes.ts` (`SettingsController.getPublicSettings`); `apps/salonflow-api/src/modules/settings/settings.service.ts` (`SettingsService.getSettings`); `apps/salonflow-api/src/modules/settings/settings.repository.ts` (`SettingsRepository.getSettings`); supplemental tenant metadata in `apps/salonflow-api/src/modules/tenants/tenant.public.routes.ts` (`router.get('/public/tenant', ...)`) and `apps/salonflow-api/src/modules/tenants/tenants.repository.ts` (`TenantsRepository.findById`) | Reusable with small changes | Business name, timezone, hours, and settings exist, but they are split across settings + tenants and exposed for public/internal UI rather than a narrow integration profile DTO. |
| Services | `apps/salonflow-api/src/modules/services/services.routes.ts` (`router.get('/public/services', ...)`, `router.get('/public/services-grouped', ...)`); `apps/salonflow-api/src/modules/services/services.controller.ts` (`ServicesController.listPublic`); `apps/salonflow-api/src/modules/services/services.service.ts` (`ServicesService.listPublicServices`); `apps/salonflow-api/src/modules/servicesV2/services.routes.ts` (public v2 service routes); `apps/salonflow-api/src/modules/servicesV2/services.public.controller.ts` (`ServicesPublicController.*`); `apps/salonflow-api/src/modules/servicesV2/services.service.ts` (`ServicesV2Service.*`); repositories in `apps/salonflow-api/src/modules/services/services.repository.ts` and `apps/salonflow-api/src/modules/servicesV2/services.repo.ts` | Reusable with small changes | Public service catalogs already exist. The v2 service model is richer and better suited to a receptionist adapter, but the response shapes are still SalonFlow-specific. |
| Staff | `apps/salonflow-api/src/modules/staff/staff.routes.ts` (`router.get('/public/staff-available', ...)`); `apps/salonflow-api/src/modules/staff/staff.controller.ts` (`StaffController.listPublicAvailable`); `apps/salonflow-api/src/modules/staff/staff.service.ts` (`StaffService.createStaff`, `StaffService.updateStaff`, `StaffService.updateActive`); `apps/salonflow-api/src/modules/staff/staff.repository.ts` (`StaffRepository.listStaff`, `listActiveForService`) | Reusable with small changes | There is a public availability-oriented staff route, but not a dedicated external staff catalog endpoint. |
| Schedules | `apps/salonflow-api/src/modules/appointments/appointments.routes.ts` (`router.get('/appointments/schedule', ...)`); `apps/salonflow-api/src/modules/scheduling/scheduling.controller.ts` (`SchedulingController.workspace`); `apps/salonflow-api/src/modules/scheduling/scheduling.service.ts` (`SchedulingService.getWorkspace`); `apps/salonflow-api/src/modules/scheduling/scheduling.repository.ts` (`SchedulingRepository.listAppointmentsInRange`) | Reusable with small changes | The scheduling workspace is an internal admin view. It is good source logic, but it is not yet a narrow external API. |
| Availability | `apps/salonflow-api/src/modules/availability/availability.routes.ts` (`GET /availability`, `GET /staff/:id/availability`, `GET /staff/:id/availability/overrides`); `apps/salonflow-api/src/modules/availability/availability.controller.ts` (`AvailabilityController.availableStaff`); `apps/salonflow-api/src/modules/availability/availability.service.ts` (`AvailabilityService.listAvailableStaffWindows`); `apps/salonflow-api/src/modules/availability/availability.repository.ts` (`AvailabilityRepository.listWeekly`, `listOverrides`, `upsertOverride`) | Reusable with small changes | The current service computes staff windows, weekly schedules, and overrides, but it does not yet expose a receptionist-facing slot proposal contract. |
| Customer lookup | `apps/salonflow-api/src/modules/customers/customers.routes.ts` (`GET /customers/search`, `GET /customers/:id`); `apps/salonflow-api/src/modules/customers/customers.controller.ts` (`CustomersController.search`, `findByPhone`, `getById`, `timeline`); `apps/salonflow-api/src/modules/customers/customers.service.ts` (`CustomersService.findByPhone`, `searchByName`, `getByIdWithLastVisit`); `apps/salonflow-api/src/modules/customers/customers.repository.ts` (`CustomersRepository.findByPhone`, `searchByQuery`, `getByIdWithLastVisit`) | Reusable with small changes | Lookup exists, but the route is owner-only and not scoped as an external integration API. |
| Customer creation | `apps/salonflow-api/src/modules/customers/customers.routes.ts` (`POST /customers`); `apps/salonflow-api/src/modules/customers/customers.controller.ts` (`CustomersController.create`); `apps/salonflow-api/src/modules/customers/customers.service.ts` (`CustomersService.createCustomer`); `apps/salonflow-api/src/modules/customers/customers.repository.ts` (`CustomersRepository.createCustomer`) | Reusable with small changes | Creation is already in place and idempotency could be layered on top of the service/repository boundary. |
| Appointment creation | `apps/salonflow-api/src/modules/appointments/appointments.routes.ts` (`POST /appointments/public`, `POST /appointments`); `apps/salonflow-api/src/modules/appointments/appointments.controller.ts` (`AppointmentsController.publicCreate`, `AppointmentsController.adminCreate`); `apps/salonflow-api/src/modules/appointments/appointments.service.ts` (`AppointmentsService.publicCreateBooking`, `createInternal`); `apps/salonflow-api/src/modules/appointments/appointments.repository.ts` (`AppointmentsRepository.createAppointment`) | Reusable with small changes | This is the closest existing booking surface. It is host-resolved, tenant-scoped, and notification-coupled, so it needs a narrow integration wrapper and explicit idempotency semantics. |
| Notification / confirmation | `apps/salonflow-api/src/modules/notifications/notification.routes.ts` (owner-only notification routes); `apps/salonflow-api/src/modules/notifications/notification.controller.ts` (`NotificationsController.*`); `apps/salonflow-api/src/modules/notifications/notification.service.ts` (`NotificationService.emit`, `createInAppNotification`, `markReadByAppointment`); `apps/salonflow-api/src/modules/notifications/notification.repository.ts` (`NotificationRepository.log`, `getSettings`, `upsertSettings`); appointment confirmation endpoint in `apps/salonflow-api/src/modules/appointments/appointments.routes.ts` (`POST /appointments/:id/confirm`) and `AppointmentsController.confirm` | Reusable with small changes | Confirmation exists, but notification delivery is coupled to internal SMS/email plumbing rather than a scoped external integration contract. |
| Authentication and tenant resolution | `apps/salonflow-api/src/modules/auth/auth.routes.ts` (`/login`, `/magic-login`, `/me`, password flows); `apps/salonflow-api/src/modules/auth/auth.service.ts` (`AuthService.login`, `issueAuthResponse`, `getCurrentAccount`); `apps/salonflow-api/src/modules/auth/auth.repository.ts` (`AuthRepository.findActiveUserByEmail`, `getCurrentAccount`); `apps/salonflow-api/src/modules/tenants/tenant.resolver.ts` (`tenantResolver`); `apps/salonflow-api/src/modules/tenants/tenant.public.routes.ts` (`router.get('/public/tenant', ...)`); `apps/salonflow-api/src/modules/tenants/tenants.repository.ts` (`TenantsRepository.findBySubdomain`, `findById`, `exists`) | Unsafe for external integration | Current auth is user/session/JWT-oriented and tenant resolution is host/subdomain/auth based. That is correct for SalonFlow, but unsafe as the auth model for a third-party receptionist integration. |

## Actual Existing Endpoint Surface

The most relevant existing endpoints are:

- `GET /public/settings`
- `GET /public/tenant`
- `GET /public/services`
- `GET /public/services-grouped`
- `GET /public/v2/services/categories`
- `GET /public/v2/services/categories/:slug`
- `GET /public/v2/services/:categorySlug/:serviceSlug`
- `GET /public/v2/services/featured`
- `GET /public/staff-available`
- `GET /availability`
- `GET /staff/:id/availability`
- `POST /customers`
- `GET /customers/search`
- `POST /appointments/public`
- `POST /appointments`
- `POST /appointments/:id/confirm`
- `GET /appointments/schedule`

These are the right source surfaces, but none of them are yet a dedicated external integration API with scoped credentials and booking idempotency guarantees.

## Minimum Changes Needed Inside SalonFlow

1. Add a scoped integration auth layer.
   - Introduce integration tokens with business-scoped claims and a small scope set, instead of relying on user JWTs and host/subdomain resolution.
   - Keep tenant resolution server-side, but resolve it from the integration token or an explicit integration context header, not from browser cookies.

2. Expose a narrow receptionist integration module.
   - Add dedicated routes such as `/api/integrations/receptionist/business-profile`, `/services`, `/availability`, `/customers/resolve`, and `/bookings`.
   - Implement them as thin wrappers over the existing `SettingsService`, `ServicesService` / `ServicesV2Service`, `AvailabilityService`, `CustomersService`, and `AppointmentsService`.

3. Add booking idempotency and duplicate protection.
   - Extend appointment creation to accept and persist an idempotency key and external reference.
   - Return the existing booking if the same idempotency key is replayed.

4. Add a receptionist-safe customer resolution contract.
   - Allow find-or-create by phone + name with normalized phone handling.
   - Keep the current customer repository/service as the internal implementation.

5. Separate integration DTOs from internal UI DTOs.
   - Do not reuse internal admin response shapes directly.
   - Return only the fields needed by the receptionist agent: business profile, services, staff, availability slots, customer identity, booking result, and confirmation status.

6. Keep notification delivery behind the backend.
   - Reuse `NotificationService` and the appointment confirmation paths, but expose only a confirmation callback or a server-side notification step, never SMS/email provider credentials.

7. Add integration-focused tests.
   - Cover business profile fetch, service list, availability search, find-or-create customer, booking idempotency, and timeout/error handling.

## Bottom Line

SalonFlow is close on domain capability and internal endpoints. What is missing is a scoped, integration-first API layer that wraps existing services without exposing the browser-oriented auth and host-resolution model to the receptionist product.
