// uses requestValidator from "dist/request.dist.js"

export function validateRequest(request) {
    const valid = requestValidator(request);
    if (valid) {
        return { valid };
    } else {
        return { valid, errors: requestValidator.errors };
    }
}
