// Service to handle notification action messages from service worker
class NotificationActionService {
  constructor() {
    this.setupMessageListener();
  }

  setupMessageListener() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, action, requestId, status, error } = event.data;
        
        if (type === 'NOTIFICATION_ACTION_SUCCESS') {
          console.log('Notification action completed in background:', { action, requestId, status });
          // Just refresh the UI data - the action was already completed in background
          this.refreshRequestData(requestId);
        } else if (type === 'NOTIFICATION_ACTION_FAILED') {
          console.error('Background notification action failed:', { action, requestId, error });
        }
      });
    }
  }

  refreshRequestData(requestId) {
    // Trigger a refresh of the visitor requests data
    // This will cause the UI to update with the new status from the database
    if (window.queryClient) {
      window.queryClient.invalidateQueries({ queryKey: ["/api/visitor-requests"] });
    }
    
    // Also trigger a custom event for visitor status page
    window.dispatchEvent(new CustomEvent('visitorStatusUpdate', {
      detail: { requestId, timestamp: Date.now() }
    }));
  }
}

// Create singleton instance
export const notificationActionService = new NotificationActionService();