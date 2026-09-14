export const liquidGlassShader = `
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;

// Signed Distance Functions
// Box: p = position relative to center, b = half dimensions, r = corner radius
float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

// Smooth Min (Metaballs)
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
    return mix(a, b, h) - k * h * (1.0 - h);
}

// Map the scene: defines the geometry
float map(vec2 p) {
    vec2 center = u_resolution * 0.5;
    
    // Main card (centered)
    float d1 = sdRoundedBox(p - center, vec2(100.0, 140.0), 20.0);
    
    // Liquid ball following pointer
    // If u_pointer is (0,0), place it far away so it doesn't interfere initially
    vec2 ptr = u_pointer;
    if (ptr.x < 1.0 && ptr.y < 1.0) {
        ptr = vec2(-1000.0);
    }
    
    float d2 = sdCircle(p - ptr, 45.0);
    
    // Merge them
    return smin(d1, d2, 40.0);
}

// Simulated background pattern to demonstrate refraction
vec3 getBackground(vec2 uv) {
    // Grid pattern
    vec2 q = floor(uv * 10.0);
    float checker = mod(q.x + q.y, 2.0);
    
    // Dynamic Gradient background
    vec3 col1 = vec3(0.1, 0.1, 0.2);
    vec3 col2 = vec3(0.2, 0.4, 0.8);
    vec3 bg = mix(col1, col2, uv.y + 0.5 * sin(u_time * 0.5 + uv.x));
    
    // Add checker overlay
    bg = mix(bg, bg * 0.8, checker * 0.1);
    
    return bg;
}

vec4 main(vec2 xy) {
    // Anti-aliasing for shape edge (optional, but good for SDF)
    float d = map(xy);
    
    // Normalized UV for background sampling
    vec2 uv = xy / u_resolution;
    
    // Background (what's behind the glass)
    vec3 bg = getBackground(uv);
    
    // Edge threshold (AA)
    float alpha = 1.0 - smoothstep(-1.0, 0.0, d);
    
    if (d > 1.0) {
        // Outside the glass, just return the background dimmmed or as is
        // Returning slight transparency logic or just background
        // For visual clarity, let's just return the background for the "air"
        // so we can see the distortion in the glass vs air
        return vec4(bg, 1.0);
    }
    
    // --- Inside the Liquid Glass ---
    
    // Calculate Normal
    // Gradient calculation
    vec2 e = vec2(1.0, 0.0); // epsilon step in pixels
    float nx = map(xy + e.xy) - map(xy - e.xy);
    float ny = map(xy + e.yx) - map(xy - e.yx);
    // The normal Z component simulates the surface curvature/thickness.
    // Near edges (high gradient), normal logic varies.
    vec3 normal = normalize(vec3(nx, ny, 2.5)); // Z = 2.5 gives a nice bulge look
    
    // Optical Refraction (Snell's Law approximation)
    // Distort the UV lookup based on the XY of the normal
    vec2 refractionOffset = normal.xy * 0.04; 
    
    // Chromatic Aberration (Dispersion)
    vec3 color;
    // Red Channel
    color.r = getBackground(uv + refractionOffset * 0.95).r;
    // Green Channel
    color.g = getBackground(uv + refractionOffset).g;
    // Blue Channel
    color.b = getBackground(uv + refractionOffset * 1.05).b;
    
    // Fresnel Effect (Reflection at edges)
    // View vector is looking straight down Z (0,0,1)
    float fresnel = pow(1.0 - clamp(dot(vec3(0.0, 0.0, 1.0), normal), 0.0, 1.0), 3.0);
    
    // Add reflective highlights (white) based on Fresnel
    color = mix(color, vec3(1.0), fresnel * 0.6);
    
    // Specular highlight from a "light source"
    vec3 lightDir = normalize(vec3(-0.5, -0.5, 1.0));
    float specular = pow(max(dot(normal, lightDir), 0.0), 32.0);
    color += vec3(1.0) * specular * 0.8;
    
    return vec4(color, 1.0);
}
`;
