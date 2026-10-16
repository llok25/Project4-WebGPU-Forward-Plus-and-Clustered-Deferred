struct VertexOutput {
    @builtin(position) position: vec4f
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2f, 3>(
        vec2f(-1.f, -1.f),
        vec2f(3.f, -1.f),
        vec2f(-1.f, 3.f)
    );

    var out: VertexOutput;
    out.position = vec4f(positions[vertexIndex], 0.f, 1.f);
    return out;
}
