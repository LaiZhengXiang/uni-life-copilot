document.addEventListener('DOMContentLoaded', () => {
    const testBtn = document.getElementById('test-connection-btn');
    const responseContainer = document.getElementById('response-container');
    const responseOutput = document.getElementById('response-output');
    const statusIndicator = document.getElementById('status-indicator');

    // Assume the backend is running on default FastAPI port 8000 locally
    const BACKEND_URL = 'http://127.0.0.1:8000';

    testBtn.addEventListener('click', async () => {
        try {
            // UI state while loading
            testBtn.textContent = 'Connecting...';
            testBtn.disabled = true;

            // Make the request to the FastAPI backend
            const response = await fetch(`${BACKEND_URL}/api/health`);
            
            // Check if response is JSON (fastapi returns JSON)
            const contentType = response.headers.get("content-type");
            let data;
            if (contentType && contentType.indexOf("application/json") !== -1) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            // Display results
            responseOutput.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
            responseContainer.classList.remove('hidden');
            
            // Apply styling based on success or failure
            if (response.ok) {
                applyResponseStyles('var(--success-bg)', 'var(--success-border)');
                statusIndicator.textContent = 'SUCCESS 🟢';
                statusIndicator.style.color = 'var(--success-border)';
            } else {
                applyResponseStyles('var(--error-bg)', 'var(--error-border)');
                statusIndicator.textContent = `ERROR ${response.status} 🔴`;
                statusIndicator.style.color = 'var(--error-border)';
            }
        } catch (error) {
            // Handle network errors (e.g., backend not running)
            const errorMessage = {
                error: "Connection Refused",
                details: error.message,
                tip: "Make sure your FastAPI server is running with: uvicorn main:app --reload"
            };
            
            responseOutput.textContent = JSON.stringify(errorMessage, null, 2);
            responseContainer.classList.remove('hidden');
            
            applyResponseStyles('var(--error-bg)', 'var(--error-border)');
            statusIndicator.textContent = 'NETWORK ERROR 🔴';
            statusIndicator.style.color = 'var(--error-border)';
        } finally {
            // Reset button state
            testBtn.textContent = 'Test Connection Again';
            testBtn.disabled = false;
        }
    });
    
    function applyResponseStyles(bgColor, borderColor) {
        responseContainer.style.backgroundColor = bgColor;
        responseContainer.style.borderLeftColor = borderColor;
    }
});
