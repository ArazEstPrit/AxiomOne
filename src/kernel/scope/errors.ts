export class ScopeError extends Error {}

export class ParentScopeEndError extends ScopeError {
	constructor() {
		super();
		this.message = "Cannot end parent scope before child";
		this.name = "ParentScopeEndError";
	}
}
