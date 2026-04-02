# ShiftSync — Gherkin-style E2E scenarios
# Use these as manual test scripts or automate with Cucumber + Playwright/Cypress.
# Demo accounts (seed): admin@coastaleats.test, manager@coastaleats.test, sam@coastaleats.test, jordan@coastaleats.test — password: password123

Feature: Authentication and registration

  As anyone without a session
  I want to sign in or complete registration
  So that I can use ShiftSync with the right role

  Background:
    Given the API and web app are running
    And the database is migrated and seeded

  @anonymous
  Scenario: Successful login with valid credentials
    Given I am on the login page
    When I sign in with email "manager@coastaleats.test" and password "password123"
    Then I am redirected to the home dashboard
    And I see my name and role in the header

  @anonymous
  Scenario: Failed login with wrong password
    Given I am on the login page
    When I sign in with email "manager@coastaleats.test" and password "wrong"
    Then I see a sign-in error
    And I remain on the login page

  @admin @anonymous
  Scenario: Admin creates an invite and new user completes registration
    Given I am signed in as admin "admin@coastaleats.test"
    When I open "Team" and create an invite for a new email with role "STAFF" and required details
    Then I receive a registration link with a token
    When I open that link in a fresh session (or incognito)
    Then I see the invite details (name, email, role)
    When I set a password and confirm it
    Then I am redirected to sign in
    When I sign in with the new email and password
    Then I see the home dashboard as STAFF

# ---------------------------------------------------------------------------

Feature: Role-based navigation and access

  As a user with a specific role
  I want to see only the menus and pages I am allowed to use
  So that I cannot perform actions outside my responsibility

  @manager
  Scenario: Manager sees scheduling and analytics, not staff-only coverage as primary path
    Given I am signed in as manager "manager@coastaleats.test"
    Then I see navigation items including "Schedule", "Assignments", and "Analytics"
    And I do not see "Team" in the nav

  @staff
  Scenario: Staff sees my schedule and coverage
    Given I am signed in as staff "sam@coastaleats.test"
    Then I see navigation items including "My schedule" and "Coverage"
    And I do not see "Schedule & shifts" or "Assignments" as manager tools

  @admin
  Scenario: Admin sees Team
    Given I am signed in as admin "admin@coastaleats.test"
    Then I see "Team" in the navigation

  @admin @manager @staff
  Scenario: All signed-in users can see clock, notifications, notifications, settings
    Given I am signed in as "<role>" with email "<email>"
    Then I see "Clock" and "Notifications" and "Settings" in the navigation
    Examples:
      | role    | email                    |
      | admin   | admin@coastaleats.test   |
      | manager | manager@coastaleats.test |
      | staff   | sam@coastaleats.test     |

# ---------------------------------------------------------------------------

Feature: Dashboard

  As a signed-in user
  I want a home dashboard
  So that I can jump to the right flows

  @manager
  Scenario: Manager dashboard shows manager-oriented links
    Given I am signed in as manager "manager@coastaleats.test"
    When I open the home dashboard
    Then I see links or guidance to schedule, assignments, analytics, and clock

  @staff
  Scenario: Staff dashboard shows staff-oriented links
    Given I am signed in as staff "sam@coastaleats.test"
    When I open the home dashboard
    Then I see links or guidance relevant to my schedule and coverage

# ---------------------------------------------------------------------------

Feature: Schedule and publish (managers)

  As a manager
  I want to build a schedule for a location and week and publish it
  So that staff only see shifts when ready

  Background:
    Given I am signed in as manager "manager@coastaleats.test"

  @manager
  Scenario: Pick week and location and view shifts
    Given I am on "Schedule & shifts"
    When I select a location and a week using the week picker (or "This week")
    Then I see shifts for that location and week or an empty list

  @manager
  Scenario: Publish week
    Given I am on "Schedule & shifts" with a location and week selected
    And there is at least one shift in draft or published state for that week
    When I choose "Publish week"
    Then the week is published successfully or I see an appropriate error

  @manager
  Scenario: Unpublish week
    Given a week is published for the selected location
    When I choose "Unpublish week"
    Then the week returns to draft or I see an appropriate message

# ---------------------------------------------------------------------------

Feature: Assignments (managers)

  As a manager
  I want to assign staff to shifts and validate rules before saving
  So that I respect skills, certifications, and labor rules

  Background:
    Given I am signed in as manager "manager@coastaleats.test"

  @manager
  Scenario: Preview assignment (automatic check)
    Given I am on "Assignments"
    When I select location, week, shift, and team member
    Then the assignment preview runs automatically and I see allowed or blocked reasons

  @manager
  Scenario: Confirm assignment
    Given a preview shows the assignment is allowed
    When I tap "Confirm assignment"
    Then the assignment is saved and I see success or confirmation details

  @manager
  Scenario: Manager cannot open assignments when not allowed
    Given I am signed in as staff "sam@coastaleats.test"
    When I navigate to "/assignments"
    Then I see access denied or am redirected to an allowed page

# ---------------------------------------------------------------------------

Feature: My schedule (staff)

  As staff
  I want to see my published shifts for a week
  So that I know when I work

  Background:
    Given I am signed in as staff "sam@coastaleats.test"

  @staff
  Scenario: View published shifts for a week
    Given a manager has published shifts for a week where I am certified
    When I open "My schedule" and select that week
    Then I see my published shifts with status and times

  @staff
  Scenario: Staff sees message when not staff role
    Given I am signed in as manager "manager@coastaleats.test"
    When I open "My schedule" path if visible or navigate directly
    Then I see that the view is for staff only or equivalent messaging

# ---------------------------------------------------------------------------

Feature: Coverage requests (staff workflow)

  As staff
  I want to request coverage swaps or drops
  So that others and managers can accept and approve

  Background:
    Given I am signed in as staff "sam@coastaleats.test"

  @staff
  Scenario: View my shifts for coverage context
    Given I am on "Coverage"
    When I select a week
    Then I see my shifts for that week to use as references

  @staff @manager
  Scenario: Manager approves after staff flow (requires second session or user)
    Given staff "sam@coastaleats.test" has created a coverage request
    And staff "jordan@coastaleats.test" has accepted where applicable
    When I sign in as manager "manager@coastaleats.test"
    And I approve the request using the request id from notifications
    Then the request reaches a terminal approved state

# ---------------------------------------------------------------------------

Feature: Clock and on-duty

  As staff I want to clock in and out
  As a manager I want to see who is on site

  @staff
  Scenario: Staff clocks in and out
    Given I am signed in as staff "sam@coastaleats.test"
    When I open "Clock" and select a week and a shift I am assigned to
    And I clock in
    Then I see an active session or success state
    When I clock out
    Then I am no longer on duty

  @manager
  Scenario: Manager sees on-duty list
    Given staff is clocked in at a location the manager can see
    When I sign in as manager "manager@coastaleats.test"
    And I open "Clock" and select that location
    Then I see on-duty staff or an updated list after refresh

# ---------------------------------------------------------------------------

Feature: Analytics (managers)

  As a manager
  I want fairness and overtime reports for a location and week
  So that I can review workload

  @manager
  Scenario: Load analytics for location and week
    Given I am signed in as manager "manager@coastaleats.test"
    When I open "Analytics"
    And I select a location and week
    Then I see fairness and overtime sections load or show empty/error states clearly

# ---------------------------------------------------------------------------

Feature: Notifications

  As any user
  I want an in-app notification feed
  So that I see assignment and coverage events

  @admin @manager @staff
  Scenario: Open notifications
    Given I am signed in as "<email>" with role "<role>"
    When I open "Notifications"
    Then I see a list of notifications or an empty state
    Examples:
      | role    | email                    |
      | admin   | admin@coastaleats.test   |
      | manager | manager@coastaleats.test |
      | staff   | sam@coastaleats.test     |

# ---------------------------------------------------------------------------

Feature: Settings

  As any user
  I want to adjust preferences
  So that notifications and profile-related options persist

  @staff
  Scenario: Update notification preferences
    Given I am signed in as staff "sam@coastaleats.test"
    When I open "Settings" and change notification toggles
    And I save or the changes apply
    Then I reload or sign in again and preferences remain

# ---------------------------------------------------------------------------

Feature: Admin — team and invites

  As an admin
  I want to see managers and staff and invite users by role
  So that I can onboard people without a public signup page

  @admin
  Scenario: Invite manager with locations
    Given I am signed in as admin "admin@coastaleats.test"
    When I open "Team"
    And I enter email, name, role "MANAGER", and at least one location
    And I create the invite
    Then I see a copyable registration link and expiry information

  @admin
  Scenario: Non-admin cannot invite
    Given I am signed in as manager "manager@coastaleats.test"
    When I navigate to "/admin/team"
    Then I see that only administrators can view team and create invites or equivalent

# ---------------------------------------------------------------------------

Feature: Cross-user and real-time smoke (optional)

  As a tester
  I want two browser sessions to verify updates propagate
  So that I can validate multi-user behavior

  @multi-session
  Scenario: Two browsers — manager publishes, staff sees schedule
    Given session A is manager on "Schedule & shifts"
    And session B is staff on "My schedule"
    When session A publishes the week for a seeded week with shifts
    And session B selects the same week
    Then session B sees published shifts after refresh or real-time update
