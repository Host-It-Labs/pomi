export function shouldHideVacationCoveredTasks(
  vacationExtensionEnabled: boolean | undefined,
  showVacationCoveredTasks: boolean | undefined,
  vacationActive: boolean
) {
  return (
    vacationExtensionEnabled === true &&
    showVacationCoveredTasks === false &&
    vacationActive
  );
}
